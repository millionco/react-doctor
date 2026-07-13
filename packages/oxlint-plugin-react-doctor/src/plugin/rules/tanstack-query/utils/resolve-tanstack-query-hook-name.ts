import { TANSTACK_QUERY_HOOKS } from "../../../constants/tanstack.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTanstackQuerySource } from "../../../utils/is-tanstack-query-source.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";

const resolveTanstackNamespaceHookName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
  contextNode: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (
    !(
      (isNodeOfType(memberExpression.property, "Identifier") && !memberExpression.computed) ||
      (isNodeOfType(memberExpression.property, "Literal") &&
        memberExpression.computed &&
        typeof memberExpression.property.value === "string")
    ) ||
    !isNodeOfType(memberExpression.object, "Identifier")
  ) {
    return null;
  }
  const hookName = isNodeOfType(memberExpression.property, "Identifier")
    ? memberExpression.property.name
    : String(memberExpression.property.value);
  if (!TANSTACK_QUERY_HOOKS.has(hookName)) return null;
  const resolvedNamespaceSymbol = resolveConstIdentifierAlias(memberExpression.object, scopes);
  if (resolvedNamespaceSymbol?.kind !== "import") return null;
  const namespaceBinding = getImportBindingForName(contextNode, resolvedNamespaceSymbol.name);
  return namespaceBinding?.isNamespace && isTanstackQuerySource(namespaceBinding.source)
    ? hookName
    : null;
};

export const resolveTanstackQueryHookName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) {
    const resolvedSymbol = resolveConstIdentifierAlias(callee, scopes);
    if (!resolvedSymbol) return null;
    if (resolvedSymbol.kind === "const" && resolvedSymbol.initializer) {
      const initializer = stripParenExpression(resolvedSymbol.initializer);
      return isNodeOfType(initializer, "MemberExpression")
        ? resolveTanstackNamespaceHookName(initializer, callExpression, scopes)
        : null;
    }
    if (resolvedSymbol.kind !== "import") return null;
    const importBinding = getImportBindingForName(callExpression, resolvedSymbol.name);
    if (importBinding === null) return null;
    if (importBinding.isNamespace || !isTanstackQuerySource(importBinding.source)) return null;
    return importBinding.exportedName !== null &&
      TANSTACK_QUERY_HOOKS.has(importBinding.exportedName)
      ? importBinding.exportedName
      : null;
  }
  if (isNodeOfType(callee, "MemberExpression")) {
    return resolveTanstackNamespaceHookName(callee, callExpression, scopes);
  }
  return null;
};

export const resolveTanstackQueryHookNameFromInitializer = (
  initializer: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const unwrappedInitializer = stripParenExpression(initializer);
  if (isNodeOfType(unwrappedInitializer, "CallExpression")) {
    return resolveTanstackQueryHookName(unwrappedInitializer, scopes);
  }
  if (!isNodeOfType(unwrappedInitializer, "Identifier")) return null;
  const resolvedSymbol = resolveConstIdentifierAlias(unwrappedInitializer, scopes);
  if (resolvedSymbol?.kind !== "const" || !resolvedSymbol.initializer) return null;
  const resolvedInitializer = stripParenExpression(resolvedSymbol.initializer);
  if (!isNodeOfType(resolvedInitializer, "CallExpression")) return null;
  return resolveTanstackQueryHookName(resolvedInitializer, scopes);
};
