import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

export const getClosedComponentJsxCalls = (
  component: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"JSXOpeningElement">[] | null => {
  if (
    (!isNodeOfType(component, "ArrowFunctionExpression") &&
      !isNodeOfType(component, "FunctionDeclaration")) ||
    component.async ||
    ("generator" in component && component.generator) ||
    component.typeParameters ||
    !component.body ||
    findEnclosingFunction(component)
  )
    return null;
  const program = context.scopes.rootScope.node;
  if (!isNodeOfType(program, "Program")) return null;
  if (isNodeOfType(component, "FunctionDeclaration")) {
    if (component.parent !== program || !isNodeOfType(component.id, "Identifier")) return null;
  } else {
    const declarator = component.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== component ||
      !isNodeOfType(declarator.id, "Identifier")
    )
      return null;
    const declaration = declarator.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const" ||
      declaration.parent !== program
    )
      return null;
  }
  const outerSymbols = getFunctionBindingSymbols(component, context.scopes);
  if (outerSymbols.length !== 1) return null;
  const outerSymbol = outerSymbols[0];
  if (
    !outerSymbol ||
    outerSymbol.scope !== context.scopes.rootScope ||
    outerSymbol.initializer !== component ||
    context.scopes.rootScope.symbols.filter(
      (symbol) =>
        symbol.name === outerSymbol.name &&
        symbol.kind !== "ts-interface" &&
        symbol.kind !== "ts-type-alias",
    ).length !== 1 ||
    hasVisibleAmbientFunctionDeclaration(outerSymbol.scope, outerSymbol.name)
  )
    return null;
  const selfSymbols =
    context.scopes
      .ownScopeFor(component)
      ?.symbols.filter(
        (symbol) =>
          symbol.bindingIdentifier === outerSymbol.bindingIdentifier &&
          symbol.initializer === component,
      ) ?? [];
  const symbols = [...new Set([outerSymbol, ...selfSymbols])];
  if (symbols.some((symbol) => !hasCompleteSymbolReferences(symbol, program, context.scopes)))
    return null;
  const openings = new Set<EsTreeNodeOfType<"JSXOpeningElement">>();
  for (const symbol of symbols) {
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      if (isKeyedDraftTypeReference(identifier)) continue;
      const parent = identifier.parent;
      if (reference.flag !== "read" || !isNodeOfType(identifier, "JSXIdentifier")) return null;
      if (isNodeOfType(parent, "JSXOpeningElement") && parent.name === identifier) {
        const element = parent.parent;
        if (!isNodeOfType(element, "JSXElement")) return null;
        if (!parent.selfClosing) {
          const closing = element.closingElement;
          if (
            !closing ||
            !isNodeOfType(closing.name, "JSXIdentifier") ||
            !symbols.some((candidate) => context.scopes.symbolFor(closing.name) === candidate)
          )
            return null;
        }
        openings.add(parent);
      } else if (isNodeOfType(parent, "JSXClosingElement") && parent.name === identifier) {
        const element = parent.parent;
        if (
          !isNodeOfType(element, "JSXElement") ||
          !isNodeOfType(element.openingElement.name, "JSXIdentifier") ||
          !symbols.some(
            (candidate) => context.scopes.symbolFor(element.openingElement.name) === candidate,
          )
        )
          return null;
      } else return null;
    }
  }
  return openings.size > 0 ? [...openings] : null;
};
