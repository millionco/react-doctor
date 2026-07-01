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

const isMemberCallWithProperty = (
  node: EsTreeNode,
  propertyNames: Set<string>
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  propertyNames.has(node.callee.property.name);

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

      let observerConstruction: EsTreeNode | null = null;
      let didObserve = false;
      let didRelease = false;

      walkAst(callback, (child: EsTreeNode) => {
        if (
          isNodeOfType(child, "NewExpression") &&
          isNodeOfType(child.callee, "Identifier") &&
          EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(child.callee.name)
        ) {
          observerConstruction ??= child;
          return;
        }
        if (isMemberCallWithProperty(child, OBSERVER_RELEASE_METHOD_NAMES)) {
          didRelease = true;
          return;
        }
        if (
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "MemberExpression") &&
          !child.callee.computed &&
          isNodeOfType(child.callee.property, "Identifier") &&
          child.callee.property.name === "observe"
        ) {
          didObserve = true;
        }
      });

      if (!observerConstruction || !didObserve || didRelease) return;
      context.report({
        node: observerConstruction,
        message:
          "This observer is created and started in the effect but never disconnected, so it keeps firing against detached nodes and leaks one observer per mount; return a cleanup that calls `disconnect()` or `unobserve()`.",
      });
    },
  }),
});
