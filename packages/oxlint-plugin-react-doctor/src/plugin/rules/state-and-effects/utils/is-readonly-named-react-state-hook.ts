import { PLAIN_STATE_ALIAS_UNSUPPORTED_NODE_TYPES } from "../../../constants/plain-state-alias.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const closedReactStatePrograms = new WeakMap<ScopeAnalysis, boolean>();

export const isReadonlyNamedReactStateHook = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !declaration ||
    declaration.source.value !== "react" ||
    isTypeOnlyImport(declaration) ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== "useState"
  )
    return false;
  const cached = closedReactStatePrograms.get(scopes);
  if (cached !== undefined) return cached;
  let isClosed = true;
  const typeOnlyProviderNames = new Set<string>();
  walkAst(scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (
      PLAIN_STATE_ALIAS_UNSUPPORTED_NODE_TYPES.has(node.type) ||
      node.type === "ImportExpression"
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "eval" || node.name === "require") &&
      scopes.referenceFor(node)
    ) {
      const providerSymbol = scopes.symbolFor(node);
      if (
        scopes.isGlobalReference(node) ||
        (providerSymbol &&
          isErasedTypeScriptBinding(providerSymbol) &&
          !hasRuntimeValueBinding(providerSymbol))
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration") || node.source.value !== "react") return;
    for (const specifier of node.specifiers) {
      if (
        isTypeOnlyImport(node) ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
      ) {
        typeOnlyProviderNames.add(specifier.local.name);
        continue;
      }
      const isNamedStateHook =
        isNodeOfType(specifier, "ImportSpecifier") &&
        specifier.importKind !== "type" &&
        getImportedName(specifier) === "useState";
      const isNamespaceProvider =
        isNodeOfType(specifier, "ImportDefaultSpecifier") ||
        isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
        (isNodeOfType(specifier, "ImportSpecifier") &&
          specifier.importKind !== "type" &&
          getImportedName(specifier) === "default");
      if (!isNamedStateHook && !isNamespaceProvider) continue;
      const importedSymbol = scopes.symbolFor(specifier.local);
      if (!importedSymbol) {
        isClosed = false;
        return false;
      }
      for (const reference of importedSymbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const consumer = referenceRoot.parent;
        if (
          isNamespaceProvider ||
          reference.flag !== "read" ||
          !isNodeOfType(consumer, "CallExpression") ||
          consumer.optional ||
          consumer.callee !== referenceRoot
        ) {
          isClosed = false;
          return false;
        }
      }
    }
  });
  if (isClosed && typeOnlyProviderNames.size) {
    const pendingScopes = [scopes.rootScope];
    let currentScope = pendingScopes.pop();
    while (currentScope && isClosed) {
      pendingScopes.push(...currentScope.children);
      for (const reference of currentScope.references) {
        const identifier = reference.identifier;
        if (
          !isNodeOfType(identifier, "Identifier") ||
          !typeOnlyProviderNames.has(identifier.name) ||
          isTypeScriptTypePosition(identifier)
        )
          continue;
        if (!reference.resolvedSymbol || !hasRuntimeValueBinding(reference.resolvedSymbol)) {
          isClosed = false;
          break;
        }
      }
      currentScope = pendingScopes.pop();
    }
  }
  closedReactStatePrograms.set(scopes, isClosed);
  return isClosed;
};
