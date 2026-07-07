import {
  QUERY_CACHE_UPDATE_METHODS,
  QUERY_CLIENT_HOOK_NAME,
  TANSTACK_MUTATION_HOOKS,
  TANSTACK_QUERY_MODULE_PATTERN,
  TRPC_UTILS_HOOK_PATTERN,
  TRPC_UTILS_INVALIDATE_METHOD,
} from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
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

// Words that mark a mutation as read-style: it fetches, checks, or produces
// something ephemeral (a download URL, a validation verdict, a pairing code,
// an OAuth redirect, a signature) without changing any server data a cached
// query could go stale on. Matched word-by-word against the enclosing hook
// name, the result binding, and the mutationFn callee.
const READ_ONLY_MUTATION_WORDS = new Set([
  "download",
  "export",
  "validate",
  "validation",
  "verify",
  "verification",
  "test",
  "preview",
  "oauth",
  "pairing",
  "sign",
]);

// `sign` followed by one of these is an auth ACTION (signIn / signUp /
// signOut), which does mutate server-visible state — only a bare `sign`
// (signMessage, signTransaction) is a read-style wallet operation.
const SIGN_AUTH_FOLLOWER_WORDS = new Set(["in", "up", "out", "off"]);

const hasReadOnlyMutationWord = (identifierName: string): boolean => {
  const words = tokenizeIdentifierWords(identifierName);
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === "sign") {
      if (!SIGN_AUTH_FOLLOWER_WORDS.has(words[index + 1] ?? "")) return true;
      continue;
    }
    if (READ_ONLY_MUTATION_WORDS.has(word)) return true;
    // The tokenizer splits embedded acronyms (`StartSlackOAuth` → "o",
    // "auth"), so keywords can land as two adjacent words.
    const nextWord = words[index + 1];
    if (nextWord && READ_ONLY_MUTATION_WORDS.has(word + nextWord)) return true;
  }
  return false;
};

// `onSuccess: () => onSaved(summary)` — invoking a completion callback prop
// hands the outcome to the parent, which owns the refetch/invalidation (the
// doc's delegated-invalidation false positive). Only completion-verb names
// count: `onClose` / `onOpenChange` are UI-only and still flag.
const DELEGATED_CALLBACK_NAME_PATTERN = /^on[A-Z]/;
const COMPLETION_CALLBACK_VERBS = new Set([
  "save",
  "saved",
  "success",
  "complete",
  "completed",
  "done",
  "finish",
  "finished",
  "update",
  "updated",
  "create",
  "created",
  "delete",
  "deleted",
  "remove",
  "removed",
  "change",
  "changed",
  "submit",
  "submitted",
  "refresh",
  "refetch",
  "mutate",
  "mutated",
  "sync",
  "synced",
]);

const isDelegatedCompletionCallbackName = (callableName: string): boolean =>
  DELEGATED_CALLBACK_NAME_PATTERN.test(callableName) &&
  tokenizeIdentifierWords(callableName).some((word) => COMPLETION_CALLBACK_VERBS.has(word));

// Read-side tanstack-query usage that proves a `useMutation` structural
// match really is TanStack's. Only consulted when the file has no
// TanStack Query import to prove it directly (the common one-hook-per-file
// mutation wrapper always imports `useMutation` from @tanstack/*query*,
// so it stays in scope even though the stale useQuery lives elsewhere).
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

const mutationResultBindingName = (
  mutationCall: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const parent = mutationCall.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  return null;
};

const findMutationFnProperty = (
  optionsArgument: EsTreeNodeOfType<"ObjectExpression">,
): EsTreeNodeOfType<"Property"> | null => {
  for (const property of optionsArgument.properties ?? []) {
    if (
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "mutationFn"
    ) {
      return property;
    }
  }
  return null;
};

// The name of what `mutationFn` actually calls: a direct reference
// (`mutationFn: getBundleDownloadUrl`) or the callee of a concise arrow body
// (`mutationFn: (params) => getBundleDownloadUrl({ data: params })`).
const mutationFnCalleeName = (
  optionsArgument: EsTreeNodeOfType<"ObjectExpression">,
): string | null => {
  const mutationFnProperty = findMutationFnProperty(optionsArgument);
  if (!mutationFnProperty) return null;
  const mutationFnValue = mutationFnProperty.value;
  if (isNodeOfType(mutationFnValue, "Identifier")) return mutationFnValue.name;
  const functionBody = getFunctionBody(mutationFnValue);
  if (!functionBody) return null;
  let bodyExpression: EsTreeNode = functionBody;
  if (isNodeOfType(bodyExpression, "AwaitExpression") && bodyExpression.argument) {
    bodyExpression = bodyExpression.argument;
  }
  if (!isNodeOfType(bodyExpression, "CallExpression")) return null;
  const flattenedCallee = flattenCalleeName(bodyExpression.callee);
  if (!flattenedCallee) return null;
  const calleeSegments = flattenedCallee.split(".");
  return calleeSegments[calleeSegments.length - 1] ?? null;
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
      // No same-file body to inspect (import / hook result / prop): trust
      // the name.
      return (
        CACHE_SYNC_CALLABLE_NAME_PATTERN.test(callableNode.name) ||
        isDelegatedCompletionCallbackName(callableNode.name)
      );
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
    let hasTanstackQueryImport = false;

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const importSource = node.source?.value;
        if (typeof importSource === "string" && TANSTACK_QUERY_MODULE_PATTERN.test(importSource)) {
          hasTanstackQueryImport = true;
        }
      },
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

        // The doc's read-only mutation exemption: a mutation named after a
        // read/check/ephemeral operation has no cached server data to stale.
        const readOnlySignalNames = [
          mutationResultBindingName(node),
          enclosingComponentOrHookName(node),
          mutationFnCalleeName(optionsArgument),
        ];
        if (
          readOnlySignalNames.some(
            (signalName) => signalName !== null && hasReadOnlyMutationWord(signalName),
          )
        ) {
          return;
        }

        const detector = createCacheUpdateDetector(context.scopes);
        if (!detector.hasCacheUpdateWithin(optionsArgument)) {
          mutationsWithoutCacheUpdate.push(node);
        }
      },
      "Program:exit"() {
        // Suppress only when nothing ties the `useMutation` match to
        // TanStack Query: no @tanstack/*query* import AND no query-read
        // call in the file. A real useMutation file always imports the
        // hook, so this narrows out same-named exports from other
        // libraries without losing single-mutation wrapper files.
        if (!hasTanstackQueryImport && !hasQueryReadUsage) return;
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
