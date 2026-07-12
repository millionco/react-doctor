import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { isTanstackQuerySource } from "../../utils/is-tanstack-query-source.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";

// Canonical TanStack hook name for a call expression, or null when the call
// is not a TanStack Query hook. Resolves renamed imports
// (`import { useQuery as useTodosQuery }`) to their exported name and accepts
// namespace calls (`ReactQuery.useQuery(...)`). Only a hook that actually
// comes from TanStack Query qualifies: a same-named hook from another library
// (e.g. Convex's `useQuery` from `convex/react`) returns the data directly,
// so rest-destructuring it is normal. No import in the file at all still
// counts, preserving prior behavior.
const resolveTanstackQueryHookName = (
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

// Hook name behind a destructure initializer: a direct hook call, or a chain
// of exact `const` aliases rooted at one. Reassignable bindings (`let`) stay
// exempt because the destructured value may no longer be the query result.
const resolveHookNameFromInitializer = (
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

export const queryNoRestDestructuring = defineRule({
  id: "query-no-rest-destructuring",
  title: "Rest destructuring on query result",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Destructure only the fields you need, like `const { data, isLoading } = useQuery(...)`. Rest destructuring subscribes to every field and adds re-renders.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "ObjectPattern")) return;
      if (!node.init) return;

      const hasRestElement = node.id.properties?.some((property: EsTreeNode) =>
        isNodeOfType(property, "RestElement"),
      );
      if (!hasRestElement) return;

      const hookName = resolveHookNameFromInitializer(node.init, context.scopes);
      if (!hookName) return;

      context.report({
        node: node.id,
        message: `Rest-destructuring ${hookName}() subscribes to every field, so it re-renders on each change.`,
      });
    },
  }),
});
