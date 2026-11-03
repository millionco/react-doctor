import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { RuleContext } from "./rule-context.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasStableReadonlyMatcherReferences } from "./has-stable-readonly-matcher-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactNamespaceImport } from "./is-react-api-call.js";
import { isErasedMatcherReference } from "./is-erased-matcher-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
const namespaceProofsByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasStableReactNamespaceProviders = (context: RuleContext): boolean => {
  const cached = namespaceProofsByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  let valid = true;
  for (const imported of context.scopes.rootScope.symbols) {
    if (imported.kind !== "import") continue;
    const declaration = getValueImportDeclaration(imported);
    if (!isNodeOfType(declaration, "ImportDeclaration") || declaration.source.value !== "react")
      continue;
    const importedName = getImportedName(imported.declarationNode);
    const isConstructor = importedName === "Component" || importedName === "PureComponent";
    if (!isConstructor && !isReactNamespaceImport(imported.bindingIdentifier, context.scopes))
      continue;
    const aliases = getEquivalentSymbols(imported.bindingIdentifier, context.scopes);
    const aliasSymbols = new Set(aliases);
    if (!aliases.length) valid = false;
    for (const symbol of aliases) {
      if (!hasStableReadonlyMatcherReferences(symbol, context)) valid = false;
      for (const reference of symbol.references) {
        if (isErasedMatcherReference(reference.identifier)) continue;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = context.scopes.symbolFor(parent.id);
          if (alias?.kind !== "const" || !aliasSymbols.has(alias)) valid = false;
          continue;
        }
        if (isConstructor) {
          if (
            (isNodeOfType(parent, "ClassDeclaration") || isNodeOfType(parent, "ClassExpression")) &&
            parent.superClass === root
          )
            continue;
          valid = false;
          continue;
        }
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          parent.computed ||
          parent.optional ||
          isWithinAssignmentTarget(parent)
        ) {
          valid = false;
          continue;
        }
        const name = getStaticPropertyName(parent);
        const member = findTransparentExpressionRoot(parent);
        const consumer = member.parent;
        if (
          (name === "Component" || name === "PureComponent") &&
          (isNodeOfType(consumer, "ClassDeclaration") ||
            isNodeOfType(consumer, "ClassExpression")) &&
          consumer.superClass === member
        )
          continue;
        if (
          name !== "Component" &&
          name !== "PureComponent" &&
          isNodeOfType(consumer, "CallExpression") &&
          consumer.callee === member
        )
          continue;
        valid = false;
      }
    }
  }
  namespaceProofsByAnalysis.set(context.scopes, valid);
  return valid;
};
