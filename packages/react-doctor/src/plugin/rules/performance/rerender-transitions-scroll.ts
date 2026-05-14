import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const HIGH_FREQUENCY_DOM_EVENTS = new Set([
  "scroll",
  "mousemove",
  "wheel",
  "pointermove",
  "touchmove",
  "drag",
]);

const isAddEventListenerCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;
  if (node.callee.property.name !== "addEventListener") return false;
  return true;
};

const handlerCallsSetState = (handler: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") &&
    !isNodeOfType(handler, "FunctionExpression")
  ) {
    return null;
  }
  let setStateCall: EsTreeNode | null = null;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (setStateCall) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      /^set[A-Z]/.test(child.callee.name)
    ) {
      setStateCall = child;
    }
  });
  return setStateCall;
};

// HACK: scroll, mousemove, wheel, pointermove, and similar high-frequency
// DOM events fire dozens to hundreds of times per second. Calling
// `setState` from these handlers triggers a re-render on every event,
// pegging the JS thread and causing the user-visible jank these
// listeners were trying to react to. Use `useTransition`/`startTransition`
// to mark the update as non-urgent (so the browser can interrupt it for
// input), or stash the value in a ref + raf throttle, or use
// `useDeferredValue`.
export const rerenderTransitionsScroll = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap the setState in startTransition (mark as non-urgent), use useDeferredValue, or stash in a ref + rAF throttle so scroll/pointer events don't trigger a re-render per fire",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isAddEventListenerCall(node)) return;
      const eventArg = node.arguments?.[0];
      if (!isNodeOfType(eventArg, "Literal")) return;
      const eventName = eventArg.value;
      if (typeof eventName !== "string" || !HIGH_FREQUENCY_DOM_EVENTS.has(eventName)) return;

      const handler = node.arguments?.[1];
      if (!handler) return;
      const setStateCall = handlerCallsSetState(handler);
      if (!setStateCall) return;

      // Skip if the setState is already wrapped in startTransition.
      let cursor: EsTreeNode | null = setStateCall.parent ?? null;
      while (cursor && cursor !== handler) {
        if (
          isNodeOfType(cursor, "CallExpression") &&
          isNodeOfType(cursor.callee, "Identifier") &&
          (cursor.callee.name === "startTransition" ||
            cursor.callee.name === "requestAnimationFrame" ||
            cursor.callee.name === "requestIdleCallback")
        ) {
          return;
        }
        cursor = cursor.parent ?? null;
      }

      context.report({
        node: setStateCall,
        message: `setState in a "${eventName}" handler triggers re-renders at scroll/pointer frequency — wrap in startTransition (mark as non-urgent), use useDeferredValue, or stash in a ref + rAF throttle`,
      });
    },
  }),
});
