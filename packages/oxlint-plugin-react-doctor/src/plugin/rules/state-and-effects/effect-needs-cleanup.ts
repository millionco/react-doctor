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
  containsReleaseLikeCall,
  isCleanupFunctionLike,
  isCleanupReturn,
  isReleaseLikeCall,
} from "./utils/is-cleanup-return.js";
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
//   - `setInterval` with a DISCARDED id: unclearable, always a leak.
//   - a discarded `new WebSocket(...)` / `new EventSource(...)`:
//     the connection opens at construction and the handle is gone.
//   - a discarded subscribe/observe registration, but only when the
//     whole file contains no release-shaped call at all (a matching
//     `removeEventListener` / `disconnect` / `unsubscribe` elsewhere
//     means the component manages the lifecycle across functions).
// `setTimeout` is deliberately exempt on this path: a one-shot timer
// in a handler (debounce, toast dismiss) is idiomatic, self-clearing
// fire-and-forget.

const EMPTY_NAME_SET: ReadonlySet<string> = new Set();

const isDiscardedConstruction = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "ExpressionStatement");

// `addEventListener(name, handler, { once: true })` self-releases and
// `{ signal }` delegates release to an AbortController — neither leaks.
const hasSelfReleasingListenerOptions = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  (node.arguments ?? []).some(
    (argument) =>
      isNodeOfType(argument, "ObjectExpression") &&
      (argument.properties ?? []).some(
        (property) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          (property.key.name === "once" || property.key.name === "signal"),
      ),
  );

const fileReleaseScanCache = new WeakMap<EsTreeNode, boolean>();

const fileContainsReleaseLikeCall = (anyNode: EsTreeNode): boolean => {
  let programNode: EsTreeNode = anyNode;
  while (programNode.parent) programNode = programNode.parent;
  const cached = fileReleaseScanCache.get(programNode);
  if (cached !== undefined) return cached;
  let didFindRelease = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didFindRelease) return false;
    if (isReleaseLikeCall(child, EMPTY_NAME_SET, EMPTY_NAME_SET)) {
      didFindRelease = true;
      return false;
    }
  });
  fileReleaseScanCache.set(programNode, didFindRelease);
  return didFindRelease;
};

const findRetainedFunctionLeak = (retainedFunction: EsTreeNode): SubscribeLikeUsage | null => {
  if (
    !isNodeOfType(retainedFunction, "ArrowFunctionExpression") &&
    !isNodeOfType(retainedFunction, "FunctionExpression") &&
    !isNodeOfType(retainedFunction, "FunctionDeclaration")
  ) {
    return null;
  }
  const body = retainedFunction.body;
  if (!body) return null;
  // A function that also releases something manages its own resource
  // lifecycle (toggle handlers, start/stop pairs) — leave it alone.
  if (containsReleaseLikeCall(body, EMPTY_NAME_SET, EMPTY_NAME_SET)) return null;

  let leak: SubscribeLikeUsage | null = null;
  walkAst(body, (child: EsTreeNode) => {
    if (leak !== null) return false;

    if (isSocketConstruction(child) && isDiscardedConstruction(child)) {
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
      isResultDiscardedCall(child)
    ) {
      leak = { kind: "timer", node: child, resourceName: "setInterval" };
      return false;
    }

    if (
      isSubscribeOrObserveCall(child) &&
      isResultDiscardedCall(child) &&
      !hasSelfReleasingListenerOptions(child) &&
      !fileContainsReleaseLikeCall(child)
    ) {
      const propertyName =
        isNodeOfType(child.callee, "MemberExpression") &&
        isNodeOfType(child.callee.property, "Identifier")
          ? child.callee.property.name
          : "subscribe";
      leak = { kind: "subscribe", node: child, resourceName: propertyName };
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
