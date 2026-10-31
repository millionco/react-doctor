import {
  FACTORY_DYNAMIC_PROVIDER_NAMES,
  FACTORY_DYNAMIC_PROVIDER_KEYS,
  UNSUPPORTED_FACTORY_RUNTIME_TYPES,
} from "./constants.js";
import { REACT_RUNTIME_MODULE_SOURCES } from "../../../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../../utils/find-transparent-expression-root.js";
import { hasVisibleAmbientFunctionDeclaration } from "../../../../utils/has-visible-ambient-function-declaration.js";
import { getValueImportDeclaration } from "../../../../utils/get-value-import-declaration.js";
import { getImportDeclarationForSymbol } from "../../../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "../../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../../utils/get-static-property-name.js";
import { getImportedName } from "../../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../../utils/is-typescript-type-position.js";
import type { RuleContext } from "../../../../utils/rule-context.js";
import { walkAst } from "../../../../utils/walk-ast.js";

const closedProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedReactFactoryProviders = (
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const cached = closedProvidersByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  const imports = new Set<SymbolDescriptor>();
  for (const symbol of context.scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (declaration && REACT_RUNTIME_MODULE_SOURCES.has(String(declaration.source.value)))
      imports.add(symbol);
  }
  let closed = true;
  walkAst(program, (node) => {
    if (
      !closed ||
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    )
      return false;
    if (
      UNSUPPORTED_FACTORY_RUNTIME_TYPES.has(node.type) ||
      node.type === "ImportExpression" ||
      node.type === "Decorator"
    ) {
      closed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (name === null || FACTORY_DYNAMIC_PROVIDER_KEYS.has(name)) closed = false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (name === null || FACTORY_DYNAMIC_PROVIDER_KEYS.has(name)) closed = false;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const symbol = context.scopes.symbolFor(node);
    if (symbol?.bindingIdentifier === node) return;
    const parent = node.parent;
    if (
      (isNodeOfType(parent, "MemberExpression") && parent.property === node && !parent.computed) ||
      (isNodeOfType(parent, "Property") &&
        parent.key === node &&
        !parent.computed &&
        !parent.shorthand) ||
      ((isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
        parent.key === node &&
        !parent.computed) ||
      (isNodeOfType(parent, "ImportSpecifier") && parent.imported === node)
    )
      return;
    if (FACTORY_DYNAMIC_PROVIDER_NAMES.has(node.name)) {
      closed = false;
      return;
    }
    const isReactImport = Boolean(symbol && imports.has(symbol));
    if (isReactImport && symbol && !getValueImportDeclaration(symbol)) {
      closed = false;
      return;
    }
    if (!isReactImport && node.name !== "React") return;
    if (hasVisibleAmbientFunctionDeclaration(context.scopes.scopeFor(node), node.name)) {
      closed = false;
      return;
    }
    if (!isReactImport && !context.scopes.isGlobalReference(node)) {
      closed = false;
      return;
    }
    const reference = context.scopes.referenceFor(node);
    const root = findTransparentExpressionRoot(node);
    const outer = root.parent;
    const isNamedImport =
      symbol &&
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      getImportedName(symbol.declarationNode) !== "default";
    const member = isNodeOfType(outer, "MemberExpression") && outer.object === root ? outer : null;
    const call = member ? findTransparentExpressionRoot(member).parent : outer;
    if (
      !reference ||
      reference.flag !== "read" ||
      (!isNamedImport && (!member || member.optional || getStaticPropertyName(member) === null)) ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== (member ? findTransparentExpressionRoot(member) : root)
    )
      closed = false;
  });
  closedProvidersByAnalysis.set(context.scopes, closed);
  return closed;
};
