import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const OBSERVER_RELEASE_METHOD_NAMES = new Set(["disconnect", "unobserve"]);
const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);

interface TrackedObserver {
  construction: EsTreeNodeOfType<"NewExpression">;
  didObserve: boolean;
  didRelease: boolean;
  didEscape: boolean;
}

const recordObserverUsage = (
  identifier: EsTreeNodeOfType<"Identifier">,
  tracked: TrackedObserver,
): void => {
  const parent = identifier.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.id === identifier) return;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.property === identifier &&
    !parent.computed
  )
    return;
  if (
    isNodeOfType(parent, "Property") &&
    parent.key === identifier &&
    parent.value !== identifier &&
    !parent.computed
  ) {
    return;
  }
  if (isNodeOfType(parent, "MemberExpression") && parent.object === identifier) {
    if (parent.computed) {
      tracked.didEscape = true;
      return;
    }
    const accessedMethodName = isNodeOfType(parent.property, "Identifier")
      ? parent.property.name
      : null;
    if (accessedMethodName && OBSERVER_RELEASE_METHOD_NAMES.has(accessedMethodName)) {
      tracked.didRelease = true;
      return;
    }
    const isMethodCall =
      isNodeOfType(parent.parent, "CallExpression") && parent.parent.callee === parent;
    if (accessedMethodName === "observe" && isMethodCall) tracked.didObserve = true;
    return;
  }
  tracked.didEscape = true;
};

// One-shot observers release themselves through the callback's SECOND
// parameter — `new IntersectionObserver((entries, obs) => { ...
// obs.disconnect() })` — the spec-provided reference to the observer
// itself. A release through that alias is as real as one through the
// binding.
const callbackReleasesViaObserverParameter = (
  construction: EsTreeNodeOfType<"NewExpression">,
): boolean => {
  const observerCallback = construction.arguments?.[0]
    ? stripParenExpression(construction.arguments[0] as EsTreeNode)
    : null;
  if (
    !observerCallback ||
    (!isNodeOfType(observerCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(observerCallback, "FunctionExpression"))
  ) {
    return false;
  }
  const callbackFunction = observerCallback;
  const observerParameter = callbackFunction.params?.[1];
  if (!observerParameter || !isNodeOfType(observerParameter as EsTreeNode, "Identifier")) {
    return false;
  }
  const parameterName = (observerParameter as EsTreeNodeOfType<"Identifier">).name;
  let didRelease = false;
  walkAst(callbackFunction, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === parameterName &&
      isNodeOfType(child.property, "Identifier") &&
      OBSERVER_RELEASE_METHOD_NAMES.has(child.property.name)
    ) {
      didRelease = true;
      return false;
    }
  });
  return didRelease;
};

export const effectObserverNeedsDisconnect = defineRule({
  id: "effect-observer-needs-disconnect",
  title: "Observer created in an effect never disconnected",
  severity: "error",
  category: "Bugs",
  recommendation:
    "Return a cleanup function that calls `observer.disconnect()` (or `observer.unobserve(node)`) so the observer stops firing callbacks against detached nodes after unmount instead of leaking on every mount.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const trackedObserversByName = new Map<string, TrackedObserver>();
      walkAst(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "NewExpression")) return;
        const isObserverConstructor = isNodeOfType(child.callee, "Identifier")
          ? EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(child.callee.name)
          : isNodeOfType(child.callee, "MemberExpression") &&
            !child.callee.computed &&
            isNodeOfType(child.callee.object, "Identifier") &&
            GLOBAL_OBJECT_NAMES.has(child.callee.object.name) &&
            isNodeOfType(child.callee.property, "Identifier") &&
            EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(child.callee.property.name);
        if (!isObserverConstructor) return;
        const declarator = child.parent;
        if (!isNodeOfType(declarator, "VariableDeclarator") || declarator.init !== child) return;
        const bindingName = isNodeOfType(declarator.id, "Identifier") ? declarator.id.name : null;
        if (!bindingName || trackedObserversByName.has(bindingName)) return;
        trackedObserversByName.set(bindingName, {
          construction: child,
          didObserve: false,
          didRelease: callbackReleasesViaObserverParameter(child),
          didEscape: false,
        });
      });
      if (trackedObserversByName.size === 0) return;

      walkAst(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "Identifier")) return;
        const tracked = trackedObserversByName.get(child.name);
        if (tracked) recordObserverUsage(child, tracked);
      });

      for (const tracked of trackedObserversByName.values()) {
        if (!tracked.didObserve || tracked.didRelease || tracked.didEscape) continue;
        context.report({
          node: tracked.construction,
          message:
            "This observer is created and started in the effect but never disconnected, so it keeps firing against detached nodes and leaks one observer per mount; return a cleanup that calls `disconnect()` or `unobserve()`.",
        });
      }
    },
  }),
});
