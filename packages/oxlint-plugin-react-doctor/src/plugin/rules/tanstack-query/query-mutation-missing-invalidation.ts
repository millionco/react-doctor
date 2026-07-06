import {
  QUERY_CACHE_UPDATE_METHODS,
  QUERY_CLIENT_HOOK_NAME,
  TANSTACK_MUTATION_HOOKS,
  TRPC_UTILS_HOOK_PATTERN,
  TRPC_UTILS_INVALIDATE_METHOD,
} from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Helper names that signal delegated cache synchronization when the callable
// cannot be resolved to a same-file body (imported hooks/utilities such as
// `useInvalidate()`, `invalidateCaseCommentQueries`, `refetchTaskCache`,
// `setVertexDetailsQueryCache`).
const CACHE_SYNC_CALLABLE_NAME_PATTERN = /invalidat|refetch|querycache/i;
const QUERY_CLIENT_BINDING_NAME = "queryClient";
const MUTATION_LIFECYCLE_CALLBACK_NAMES = new Set([
  "onSuccess",
  "onSettled",
  "onError",
  "onMutate",
]);
const FULL_PAGE_NAVIGATION_METHODS = new Set(["assign", "reload", "replace"]);
const MAX_HELPER_RESOLUTION_DEPTH = 3;

// Read-side tanstack-query usage that proves this file has cached data a
// mutation could leave stale. Mutations in files with no query in sight
// (analytics posts, connection tests, message signing) have nothing to
// invalidate.
const QUERY_READ_HOOK_NAMES = new Set([
  "useQuery",
  "useInfiniteQuery",
  "useSuspenseQuery",
  "useSuspenseInfiniteQuery",
  "useQueries",
  "queryOptions",
  "infiniteQueryOptions",
  QUERY_CLIENT_HOOK_NAME,
]);
const QUERY_READ_METHOD_NAMES = new Set([
  "getQueryData",
  "fetchQuery",
  "prefetchQuery",
  "ensureQueryData",
]);

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

const isQueryClientValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") &&
  (node.name === QUERY_CLIENT_BINDING_NAME || isBindingFromQueryCacheHook(node, scopes));

const getFunctionBody = (node: EsTreeNode | null): EsTreeNode | null => {
  if (!node) return null;
  if (
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "FunctionDeclaration")
  ) {
    return node.body ?? null;
  }
  return null;
};

// A full-page navigation (`window.location.href = ...`, `location.reload()`)
// tears the whole document down, so the query cache cannot serve stale data
// after the mutation settles.
const isFullPageNavigation = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "AssignmentExpression")) {
    const flattenedTarget = flattenCalleeName(node.left);
    return Boolean(flattenedTarget && /(?:^|\.)location\.href$/.test(flattenedTarget));
  }
  if (isNodeOfType(node, "CallExpression")) {
    const flattenedCallee = flattenCalleeName(node.callee);
    if (!flattenedCallee) return false;
    const calleeSegments = flattenedCallee.split(".");
    const methodName = calleeSegments[calleeSegments.length - 1] ?? "";
    return calleeSegments.includes("location") && FULL_PAGE_NAVIGATION_METHODS.has(methodName);
  }
  return false;
};

interface CacheUpdateDetector {
  hasCacheUpdateWithin: (root: EsTreeNode) => boolean;
}

const createCacheUpdateDetector = (scopes: ScopeAnalysis): CacheUpdateDetector => {
  const visitedHelperNodes = new Set<EsTreeNode>();

  const doesCallableSyncCache = (callableNode: EsTreeNode, remainingDepth: number): boolean => {
    if (isNodeOfType(callableNode, "Identifier")) {
      // `const { setQueryData } = useQueryClient()` then a bare
      // `setQueryData(...)` — the binding must actually come from the query
      // cache: a bare `clear()` from `useForm()` still flags.
      if (
        QUERY_CACHE_UPDATE_METHODS.has(callableNode.name) &&
        isBindingFromQueryCacheHook(callableNode, scopes)
      ) {
        return true;
      }
      const resolvedSymbol = scopes.referenceFor(callableNode)?.resolvedSymbol;
      const helperBody = getFunctionBody(resolvedSymbol?.initializer ?? null);
      if (helperBody) {
        if (remainingDepth <= 0 || visitedHelperNodes.has(helperBody)) return false;
        visitedHelperNodes.add(helperBody);
        return hasCacheUpdateWithin(helperBody, remainingDepth - 1);
      }
      // No same-file body to inspect (import / hook result): trust the name.
      return CACHE_SYNC_CALLABLE_NAME_PATTERN.test(callableNode.name);
    }

    if (
      isNodeOfType(callableNode, "MemberExpression") &&
      isNodeOfType(callableNode.property, "Identifier") &&
      !callableNode.computed
    ) {
      const memberMethodName = callableNode.property.name;
      if (QUERY_CACHE_UPDATE_METHODS.has(memberMethodName)) return true;
      // A bare `.invalidate()` verb only counts when the receiver chain is
      // rooted in a `useQueryClient()` / `use*Utils()` binding, so
      // `session.invalidate()` still flags.
      if (memberMethodName === TRPC_UTILS_INVALIDATE_METHOD) {
        const rootIdentifier = findMemberChainRootIdentifier(callableNode.object);
        return Boolean(rootIdentifier && isBindingFromQueryCacheHook(rootIdentifier, scopes));
      }
      return CACHE_SYNC_CALLABLE_NAME_PATTERN.test(memberMethodName);
    }

    return false;
  };

  const nodeIndicatesCacheUpdate = (node: EsTreeNode, remainingDepth: number): boolean => {
    if (isFullPageNavigation(node)) return true;

    if (isNodeOfType(node, "CallExpression")) {
      if (doesCallableSyncCache(node.callee, remainingDepth)) return true;
      // Handing the query client to a helper (`fetchDetails(queryClient)`)
      // delegates the cache update to it.
      return (node.arguments ?? []).some((argument) => isQueryClientValue(argument, scopes));
    }

    // `onSuccess: invalidate` — a lifecycle callback passed by reference.
    if (
      isNodeOfType(node, "Property") &&
      isNodeOfType(node.key, "Identifier") &&
      MUTATION_LIFECYCLE_CALLBACK_NAMES.has(node.key.name) &&
      (isNodeOfType(node.value, "Identifier") || isNodeOfType(node.value, "MemberExpression"))
    ) {
      return doesCallableSyncCache(node.value, remainingDepth);
    }

    return false;
  };

  const hasCacheUpdateWithin = (root: EsTreeNode, remainingDepth: number): boolean => {
    let didFindCacheUpdate = false;
    walkAst(root, (child: EsTreeNode) => {
      if (didFindCacheUpdate) return false;
      if (nodeIndicatesCacheUpdate(child, remainingDepth)) {
        didFindCacheUpdate = true;
        return false;
      }
    });
    return didFindCacheUpdate;
  };

  return {
    hasCacheUpdateWithin: (root: EsTreeNode) =>
      hasCacheUpdateWithin(root, MAX_HELPER_RESOLUTION_DEPTH),
  };
};

export const queryMutationMissingInvalidation = defineRule({
  id: "query-mutation-missing-invalidation",
  title: "Mutation without cache invalidation",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Add `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['...'] })` so cached data stays in sync after the mutation",
  create: (context: RuleContext) => {
    const mutationsWithoutCacheUpdate: EsTreeNodeOfType<"CallExpression">[] = [];
    let hasQueryReadUsage = false;

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!hasQueryReadUsage) {
          const callName = getCalleeName(node);
          if (
            callName &&
            (QUERY_READ_HOOK_NAMES.has(callName) ||
              QUERY_READ_METHOD_NAMES.has(callName) ||
              TRPC_UTILS_HOOK_PATTERN.test(callName))
          ) {
            hasQueryReadUsage = true;
          }
        }

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

        const detector = createCacheUpdateDetector(context.scopes);
        if (!detector.hasCacheUpdateWithin(optionsArgument)) {
          mutationsWithoutCacheUpdate.push(node);
        }
      },
      "Program:exit"() {
        if (!hasQueryReadUsage) return;
        for (const mutationNode of mutationsWithoutCacheUpdate) {
          context.report({
            node: mutationNode,
            message:
              "useMutation with no cache update here can leave your users looking at stale data after it runs.",
          });
        }
      },
    };
  },
});
