import {
  QUERY_CACHE_UPDATE_METHODS,
  QUERY_CLIENT_HOOK_NAME,
  TANSTACK_MUTATION_HOOKS,
  TRPC_UTILS_HOOK_PATTERN,
  TRPC_UTILS_INVALIDATE_METHOD,
} from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// True when `initializer` is a call to a hook whose result owns the query
// cache: `useQueryClient()` or a tRPC utils proxy (`api.useUtils()`).
const isQueryCacheSourceCall = (initializer: EsTreeNode | null): boolean => {
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const hookName = getCalleeName(initializer);
  if (!hookName) return false;
  return hookName === QUERY_CLIENT_HOOK_NAME || TRPC_UTILS_HOOK_PATTERN.test(hookName);
};

const findMemberChainRootIdentifier = (
  memberObject: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  let cursor: EsTreeNode | null | undefined = memberObject;
  while (cursor) {
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object;
      continue;
    }
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    break;
  }
  return cursor && isNodeOfType(cursor, "Identifier") ? cursor : null;
};

const isBindingFromQueryCacheHook = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const resolvedSymbol = scopes.referenceFor(identifier)?.resolvedSymbol;
  return Boolean(resolvedSymbol && isQueryCacheSourceCall(resolvedSymbol.initializer));
};

export const queryMutationMissingInvalidation = defineRule({
  id: "query-mutation-missing-invalidation",
  title: "Mutation without cache invalidation",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Add `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['...'] })` so cached data stays in sync after the mutation",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;

      if (!calleeName || !TANSTACK_MUTATION_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return;

      const hasMutationFn = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "mutationFn",
      );

      if (!hasMutationFn) return;

      let hasCacheUpdate = false;
      walkAst(optionsArgument, (child: EsTreeNode) => {
        if (hasCacheUpdate) return false;
        if (!isNodeOfType(child, "CallExpression")) return;
        // `queryClient.invalidateQueries(...)` — member-call form. The generic
        // `utils.posts.invalidate()` verb only counts when the receiver chain
        // is rooted in a `useQueryClient()` / `use*Utils()` binding, so
        // `session.invalidate()` still flags.
        if (
          isNodeOfType(child.callee, "MemberExpression") &&
          isNodeOfType(child.callee.property, "Identifier")
        ) {
          const memberMethodName = child.callee.property.name;
          if (QUERY_CACHE_UPDATE_METHODS.has(memberMethodName)) {
            hasCacheUpdate = true;
            return false;
          }
          if (memberMethodName === TRPC_UTILS_INVALIDATE_METHOD) {
            const rootIdentifier = findMemberChainRootIdentifier(child.callee.object);
            if (rootIdentifier && isBindingFromQueryCacheHook(rootIdentifier, context.scopes)) {
              hasCacheUpdate = true;
              return false;
            }
          }
        }
        // `const { invalidateQueries } = useQueryClient()` then a bare
        // `invalidateQueries(...)` — destructured-callee form. The binding
        // must actually come from the query cache: a bare `clear()` from
        // `useForm()` (or any unrelated local helper) still flags.
        if (
          isNodeOfType(child.callee, "Identifier") &&
          QUERY_CACHE_UPDATE_METHODS.has(child.callee.name) &&
          isBindingFromQueryCacheHook(child.callee, context.scopes)
        ) {
          hasCacheUpdate = true;
          return false;
        }
      });

      if (!hasCacheUpdate) {
        context.report({
          node,
          message:
            "useMutation with no cache update leaves your users looking at stale data after it runs.",
        });
      }
    },
  }),
});
