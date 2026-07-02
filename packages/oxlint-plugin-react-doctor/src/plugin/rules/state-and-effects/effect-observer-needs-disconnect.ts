import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
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

const isObserverConstruction = (node: EsTreeNode): node is EsTreeNodeOfType<"NewExpression"> => {
  if (!isNodeOfType(node, "NewExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier")) {
    return EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(node.callee.name);
  }
  return (
    isNodeOfType(node.callee, "MemberExpression") &&
    !node.callee.computed &&
    isNodeOfType(node.callee.object, "Identifier") &&
    GLOBAL_OBJECT_NAMES.has(node.callee.object.name) &&
    isNodeOfType(node.callee.property, "Identifier") &&
    EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(node.callee.property.name)
  );
};

const getLocalObserverBindingName = (
  construction: EsTreeNodeOfType<"NewExpression">,
): string | null => {
  const parent = construction.parent;
  if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== construction) return null;
  return isNodeOfType(parent.id, "Identifier") ? parent.id.name : null;
};

const recordObserverUsage = (
  identifier: EsTreeNodeOfType<"Identifier">,
  tracked: TrackedObserver,
): void => {
  const parent = identifier.parent;
  if (!parent) {
    tracked.didEscape = true;
    return;
  }
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
        if (!isObserverConstruction(child)) return;
        const bindingName = getLocalObserverBindingName(child);
        if (!bindingName || trackedObserversByName.has(bindingName)) return;
        trackedObserversByName.set(bindingName, {
          construction: child,
          didObserve: false,
          didRelease: false,
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
