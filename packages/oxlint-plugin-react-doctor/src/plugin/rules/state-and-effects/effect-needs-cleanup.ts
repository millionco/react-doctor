import {
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
} from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isCleanupReturningSubscribeLikeCallExpression,
  isSubscribeLikeCallExpression,
} from "./utils/is-subscribe-like-call-expression.js";
import {
  isCleanupFunctionLike,
  isCleanupReturn,
  isReleaseLikeCall,
} from "./utils/is-cleanup-return.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `observer.observe(el)` is the registration moment for ResizeObserver /
// MutationObserver / IntersectionObserver et al. — subscription-shaped,
// but not in `SUBSCRIPTION_METHOD_NAMES` (other consumers of that set
// treat subscriptions as store-like).
const OBSERVER_REGISTRATION_METHOD_NAME = "observe";

interface SubscribeLikeUsage {
  kind: "subscribe" | "timer" | "socket";
  node: EsTreeNode;
  resourceName: string;
}

const RESOURCE_NOUN_BY_KIND = {
  subscribe: "subscription",
  timer: "timer",
  socket: "connection",
} as const;

const isSocketConstruction = (node: EsTreeNode): node is EsTreeNodeOfType<"NewExpression"> =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP.has(node.callee.name);

const isSubscribeOrObserveCall = (node: EsTreeNode): boolean => {
  if (isSubscribeLikeCallExpression(node)) return true;
  return (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === OBSERVER_REGISTRATION_METHOD_NAME
  );
};

const findSubscribeLikeUsages = (callback: EsTreeNode): SubscribeLikeUsage[] => {
  const usages: SubscribeLikeUsage[] = [];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return usages;
  }
  let cleanupArgument: EsTreeNode | null = null;
  if (isNodeOfType(callback.body, "BlockStatement")) {
    const callbackStatements = callback.body.body ?? [];
    const lastCallbackStatement = callbackStatements[callbackStatements.length - 1];
    if (isNodeOfType(lastCallbackStatement, "ReturnStatement") && lastCallbackStatement.argument) {
      cleanupArgument = lastCallbackStatement.argument;
    }
  }

  walkAst(callback, (child: EsTreeNode) => {
    if (child === cleanupArgument && !isSubscribeLikeCallExpression(child)) return false;

    if (isSocketConstruction(child)) {
      usages.push({
        kind: "socket",
        node: child,
        resourceName: isNodeOfType(child.callee, "Identifier") ? child.callee.name : "WebSocket",
      });
      return;
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
    ) {
      usages.push({
        kind: "timer",
        node: child,
        resourceName: child.callee.name,
      });
      return;
    }

    if (
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      (SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name) ||
        child.callee.property.name === OBSERVER_REGISTRATION_METHOD_NAME)
    ) {
      usages.push({
        kind: "subscribe",
        node: child,
        resourceName: child.callee.property.name,
      });
    }
  });
  return usages;
};

interface CleanupBindings {
  cleanupFunctionNames: Set<string>;
  subscriptionNames: Set<string>;
  effectScopeVariableNames: Set<string>;
}

const collectCleanupBindings = (effectCallback: EsTreeNode): CleanupBindings => {
  const bindings: CleanupBindings = {
    cleanupFunctionNames: new Set<string>(),
    subscriptionNames: new Set<string>(),
    effectScopeVariableNames: new Set<string>(),
  };
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return bindings;
  }
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) return bindings;

  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "VariableDeclaration")) return;
    for (const declarator of child.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const bindingName = declarator.id.name;
      bindings.effectScopeVariableNames.add(bindingName);
      const init = declarator.init;
      if (!init) continue;
      // A socket handle is not a cleanup function — returning it from
      // the effect closes nothing (cleanup is `.close()`).
      if (isSocketConstruction(init)) {
        bindings.subscriptionNames.add(bindingName);
        continue;
      }
      if (!isNodeOfType(init, "CallExpression")) continue;
      if (isSubscribeLikeCallExpression(init)) {
        bindings.subscriptionNames.add(bindingName);
        if (isCleanupReturningSubscribeLikeCallExpression(init)) {
          bindings.cleanupFunctionNames.add(bindingName);
        }
      }
    }
  });

  walkAst(effectCallback.body, (child: EsTreeNode) => {
    if (
      child !== effectCallback.body &&
      (isNodeOfType(child, "ArrowFunctionExpression") || isNodeOfType(child, "FunctionExpression"))
    ) {
      return false;
    }
    if (
      isNodeOfType(child, "FunctionDeclaration") &&
      child.id &&
      isCleanupFunctionLike(child, bindings.cleanupFunctionNames, bindings.subscriptionNames)
    ) {
      bindings.cleanupFunctionNames.add(child.id.name);
      return false;
    }
  });

  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "VariableDeclaration")) return;
    for (const declarator of child.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      if (
        isCleanupFunctionLike(
          declarator.init,
          bindings.cleanupFunctionNames,
          bindings.subscriptionNames,
        )
      ) {
        bindings.cleanupFunctionNames.add(declarator.id.name);
      }
    }
  });

  walkAst(effectCallback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      bindings.effectScopeVariableNames.has(child.left.name) &&
      isCleanupFunctionLike(child.right, bindings.cleanupFunctionNames, bindings.subscriptionNames)
    ) {
      bindings.cleanupFunctionNames.add(child.left.name);
    }
  });

  return bindings;
};

const getRangeStart = (node: EsTreeNode): number | null => {
  const rangeStart = node.range?.[0];
  return typeof rangeStart === "number" ? rangeStart : null;
};

const cleanupReturnRunsAfterUsage = (
  returnStatement: EsTreeNodeOfType<"ReturnStatement">,
  usages: ReadonlyArray<SubscribeLikeUsage>,
): boolean => {
  if (
    returnStatement.argument &&
    isCleanupReturningSubscribeLikeCallExpression(returnStatement.argument)
  ) {
    return true;
  }
  const returnStart = getRangeStart(returnStatement);
  if (returnStart === null) return true;
  return usages.some((usage) => {
    const usageStart = getRangeStart(usage.node);
    return usageStart === null || usageStart < returnStart;
  });
};

const effectHasCleanupReturn = (
  callback: EsTreeNode,
  usages: ReadonlyArray<SubscribeLikeUsage>,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return isCleanupReturningSubscribeLikeCallExpression(callback.body);
  }
  const cleanupBindings = collectCleanupBindings(callback);
  let didFindCleanupReturn = false;
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (didFindCleanupReturn) return;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (!cleanupReturnRunsAfterUsage(child, usages)) return;
    if (
      isCleanupReturn(
        child.argument,
        cleanupBindings.cleanupFunctionNames,
        cleanupBindings.subscriptionNames,
        { allowOpaqueReturn: true },
      )
    ) {
      didFindCleanupReturn = true;
    }
  });
  return didFindCleanupReturn;
};

// ---- Retained-function analysis (useCallback / component-scope handlers) ----
//
// A resource created inside a function that survives past the current
// call — a `useCallback` callback or a handler declared in component
// scope — leaks exactly like one created in an effect, but no effect
// cleanup return can ever release it. The firing policy here is much
// stricter than the effect policy to stay precise:
//   - `setInterval` with a DISCARDED id: a leak unless the same handler
//     also clears an interval (start/stop pairs manage their own ids).
//   - a discarded `new WebSocket(...)` / `new EventSource(...)`: the
//     connection opens at construction and the handle is gone, unless
//     the same handler also closes a connection (reconnect shape).
//   - a discarded subscribe/observe registration, but only when the
//     whole file contains no PAIRED release for that registration verb
//     (a `removeEventListener` elsewhere means the component manages a
//     listener's lifecycle across functions; an unrelated
//     `stream.close()` releases no listener and must not hide one).
// Nested functions are separate scopes: a leak inside an inner callback
// or a nested `useEffect` belongs to that function's own analysis, not
// to the retained handler that happens to enclose it.
// `setTimeout` is deliberately exempt on this path: a one-shot timer
// in a handler (debounce, toast dismiss) is idiomatic, self-clearing
// fire-and-forget.

const EMPTY_NAME_SET: ReadonlySet<string> = new Set();

// `addEventListener(name, handler, { once: true })` self-releases and
// `{ signal }` delegates release to an AbortController — neither leaks.
// `once` must be literally `true`: `{ once: false }` — or a value that
// may be false — keeps the listener registered.
const hasSelfReleasingListenerOptions = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  (node.arguments ?? []).some(
    (argument) =>
      isNodeOfType(argument, "ObjectExpression") &&
      (argument.properties ?? []).some(
        (property) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          (property.key.name === "signal" ||
            (property.key.name === "once" &&
              isNodeOfType(property.value, "Literal") &&
              property.value.value === true)),
      ),
  );

// A release call only counts against a leak when its verb can plausibly
// release that resource. `on` pairs with `.on(name, null)` (d3-style
// removal), which `isReleaseLikeCall` already recognizes.
const PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ["addEventListener", new Set(["removeEventListener", "abort"])],
  ["addListener", new Set(["removeListener", "off", "abort"])],
  ["on", new Set(["off", "removeListener", "on"])],
  ["subscribe", new Set(["unsubscribe", "unsub"])],
  ["sub", new Set(["unsub", "unsubscribe"])],
  ["watch", new Set(["unwatch", "close"])],
  ["listen", new Set(["unlisten", "close"])],
  [OBSERVER_REGISTRATION_METHOD_NAME, new Set(["disconnect", "unobserve"])],
]);

// Whole-lifecycle verbs that release any resource kind.
const UNIVERSAL_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set([
  "cleanup",
  "dispose",
  "destroy",
  "teardown",
]);

const SOCKET_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set(["close"]);

const INTERVAL_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set(["clearInterval"]);

const getReleaseVerbName = (node: EsTreeNode): string | null => {
  if (!isReleaseLikeCall(node, EMPTY_NAME_SET, EMPTY_NAME_SET)) return null;
  const callNode = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = isNodeOfType(callNode.callee, "ChainExpression")
    ? callNode.callee.expression
    : callNode.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

const matchesPairedReleaseVerb = (
  releaseVerbName: string,
  pairedVerbNames: ReadonlySet<string>,
): boolean =>
  pairedVerbNames.has(releaseVerbName) || UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName);

const bodyContainsPairedReleaseCall = (
  body: EsTreeNode,
  pairedVerbNames: ReadonlySet<string>,
): boolean => {
  let didFindPairedRelease = false;
  walkAst(body, (child: EsTreeNode) => {
    if (didFindPairedRelease) return false;
    if (child !== body && isFunctionLike(child)) return false;
    const releaseVerbName = getReleaseVerbName(child);
    if (releaseVerbName !== null && matchesPairedReleaseVerb(releaseVerbName, pairedVerbNames)) {
      didFindPairedRelease = true;
      return false;
    }
  });
  return didFindPairedRelease;
};

const fileReleaseVerbNamesCache = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const collectFileReleaseVerbNames = (anyNode: EsTreeNode): ReadonlySet<string> => {
  let programNode: EsTreeNode = anyNode;
  while (programNode.parent) programNode = programNode.parent;
  const cached = fileReleaseVerbNamesCache.get(programNode);
  if (cached) return cached;
  const releaseVerbNames = new Set<string>();
  walkAst(programNode, (child: EsTreeNode) => {
    const releaseVerbName = getReleaseVerbName(child);
    if (releaseVerbName !== null) releaseVerbNames.add(releaseVerbName);
  });
  fileReleaseVerbNamesCache.set(programNode, releaseVerbNames);
  return releaseVerbNames;
};

const fileContainsPairedReleaseCall = (
  registrationCall: EsTreeNode,
  registrationVerbName: string,
): boolean => {
  const fileReleaseVerbNames = collectFileReleaseVerbNames(registrationCall);
  const pairedVerbNames = PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB.get(registrationVerbName);
  if (!pairedVerbNames) return fileReleaseVerbNames.size > 0;
  for (const releaseVerbName of fileReleaseVerbNames) {
    if (matchesPairedReleaseVerb(releaseVerbName, pairedVerbNames)) return true;
  }
  return false;
};

const findRetainedFunctionLeak = (retainedFunction: EsTreeNode): SubscribeLikeUsage | null => {
  if (!isFunctionLike(retainedFunction)) return null;
  const body = retainedFunction.body;
  if (!body) return null;

  let leak: SubscribeLikeUsage | null = null;
  walkAst(body, (child: EsTreeNode) => {
    if (leak !== null) return false;
    if (isFunctionLike(child)) return false;

    if (
      isSocketConstruction(child) &&
      isResultDiscardedCall(child) &&
      !bodyContainsPairedReleaseCall(body, SOCKET_RELEASE_VERB_NAMES)
    ) {
      leak = {
        kind: "socket",
        node: child,
        resourceName: isNodeOfType(child.callee, "Identifier") ? child.callee.name : "WebSocket",
      };
      return false;
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === "setInterval" &&
      isResultDiscardedCall(child) &&
      !bodyContainsPairedReleaseCall(body, INTERVAL_RELEASE_VERB_NAMES)
    ) {
      leak = { kind: "timer", node: child, resourceName: "setInterval" };
      return false;
    }

    if (isSubscribeOrObserveCall(child) && isResultDiscardedCall(child)) {
      const registrationVerbName =
        isNodeOfType(child.callee, "MemberExpression") &&
        isNodeOfType(child.callee.property, "Identifier")
          ? child.callee.property.name
          : "subscribe";
      if (
        !hasSelfReleasingListenerOptions(child) &&
        !fileContainsPairedReleaseCall(child, registrationVerbName)
      ) {
        leak = { kind: "subscribe", node: child, resourceName: registrationVerbName };
      }
      return false;
    }
  });
  return leak;
};

const isRetainedComponentScopeFunction = (functionNode: EsTreeNode): boolean => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    return enclosingComponentOrHookName(functionNode) !== null;
  }
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionExpression")
  ) {
    return false;
  }
  // Only named component-scope bindings (`const onScroll = () => {...}`);
  // inline callback arguments are attributed to whatever consumes them.
  if (!isNodeOfType(functionNode.parent, "VariableDeclarator")) return false;
  return enclosingComponentOrHookName(functionNode) !== null;
};

export const effectNeedsCleanup = defineRule({
  id: "effect-needs-cleanup",
  title: "Effect subscription or timer never cleaned up",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Return a cleanup function that stops the subscription or timer: `return () => target.removeEventListener(name, handler)` for listeners, `return () => clearInterval(id)` or `clearTimeout(id)` for timers, `return () => observer.disconnect()` for observers, `return () => socket.close()` for connections, or `return unsubscribe` if the subscribe call already gave you one.",
  create: (context: RuleContext) => {
    const reportRetainedLeak = (retainedFunction: EsTreeNode): void => {
      const leak = findRetainedFunctionLeak(retainedFunction);
      if (!leak) return;
      const resourceNoun = RESOURCE_NOUN_BY_KIND[leak.kind];
      context.report({
        node: leak.node,
        message: `\`${leak.resourceName}\` creates a ${resourceNoun} in a function that outlives the render, with no cleanup path. Store the handle and release it, or move this into a useEffect that returns cleanup, so it does not leak after unmount.`,
      });
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isHookCall(node, "useCallback")) {
          const retainedCallback = getEffectCallback(node);
          if (retainedCallback) reportRetainedLeak(retainedCallback);
          return;
        }
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        const usages = findSubscribeLikeUsages(callback);
        if (usages.length === 0) return;

        if (effectHasCleanupReturn(callback, usages)) return;

        const firstUsage = usages[0];
        const resourceNoun = RESOURCE_NOUN_BY_KIND[firstUsage.kind];
        context.report({
          node,
          message: `\`${firstUsage.resourceName}\` creates a ${resourceNoun} in useEffect without returning cleanup. Return a cleanup function so it does not leak after unmount.`,
        });
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (isRetainedComponentScopeFunction(node)) reportRetainedLeak(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (isRetainedComponentScopeFunction(node)) reportRetainedLeak(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (isRetainedComponentScopeFunction(node)) reportRetainedLeak(node);
      },
    };
  },
});
