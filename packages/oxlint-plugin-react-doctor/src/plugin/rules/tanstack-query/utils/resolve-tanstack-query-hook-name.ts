import { TANSTACK_QUERY_HOOKS } from "../../../constants/tanstack.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTanstackQuerySource } from "../../../utils/is-tanstack-query-source.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";

export const resolveTanstackQueryHookName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) {
    const importBinding = getImportBindingForName(callExpression, callee.name);
    if (importBinding === null) {
      return TANSTACK_QUERY_HOOKS.has(callee.name) ? callee.name : null;
    }
    if (importBinding.isNamespace || !isTanstackQuerySource(importBinding.source)) return null;
    return importBinding.exportedName !== null &&
      TANSTACK_QUERY_HOOKS.has(importBinding.exportedName)
      ? importBinding.exportedName
      : null;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    TANSTACK_QUERY_HOOKS.has(callee.property.name) &&
    isNodeOfType(callee.object, "Identifier")
  ) {
    const namespaceBinding = getImportBindingForName(callExpression, callee.object.name);
    if (namespaceBinding?.isNamespace && isTanstackQuerySource(namespaceBinding.source)) {
      return callee.property.name;
    }
  }
  return null;
};

export const resolveTanstackQueryHookNameFromInitializer = (
  initializer: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (isNodeOfType(initializer, "CallExpression")) {
    return resolveTanstackQueryHookName(initializer);
  }
  if (!isNodeOfType(initializer, "Identifier")) return null;
  const resolvedSymbol = resolveConstIdentifierAlias(initializer, scopes);
  if (resolvedSymbol?.kind !== "const" || !resolvedSymbol.initializer) return null;
  if (!isNodeOfType(resolvedSymbol.initializer, "CallExpression")) return null;
  return resolveTanstackQueryHookName(resolvedSymbol.initializer);
};
