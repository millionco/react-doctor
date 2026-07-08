import { defineRule } from "../../utils/define-rule.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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

// A setter fed only constants (`setVisible(false)`, `setTooltip(null)`)
// repeats the same value on every event after the first, so React bails out
// via Object.is and no per-event redraw happens — state only flips at
// threshold crossings, not per scroll/move event.
const isConstantOnlyArgument = (argument: EsTreeNode | undefined): boolean => {
  if (!argument) return true;
  if (isNodeOfType(argument, "Literal")) return true;
  if (isNodeOfType(argument, "Identifier")) return argument.name === "undefined";
  if (isNodeOfType(argument, "TemplateLiteral")) return (argument.expressions ?? []).length === 0;
  if (isNodeOfType(argument, "UnaryExpression")) return isConstantOnlyArgument(argument.argument);
  return false;
};

const nodeReadsRefCurrent = (node: EsTreeNode): boolean => {
  let readsRef = false;
  walkAst(node, (child: EsTreeNode) => {
    if (readsRef) return;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === "current"
    ) {
      readsRef = true;
    }
  });
  return readsRef;
};

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "FunctionDeclaration");

const containsReturnStatement = (node: EsTreeNode): boolean => {
  let hasReturn = false;
  walkAst(node, (child: EsTreeNode) => {
    if (hasReturn) return;
    if (isFunctionLikeNode(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) hasReturn = true;
  });
  return hasReturn;
};

// A handler that early-returns on a `.current` comparison already
// deduplicates via a ref — the rule's own suggested fix — so the setter
// only runs when the tracked value actually changes, not per event.
const handlerDeduplicatesViaRef = (handler: EsTreeNode): boolean => {
  const handlerBody = isNodeOfType(handler, "ArrowFunctionExpression")
    ? handler.body
    : isNodeOfType(handler, "FunctionExpression")
      ? handler.body
      : null;
  if (!handlerBody) return false;
  let hasRefGuardedReturn = false;
  walkAst(handlerBody, (child: EsTreeNode) => {
    if (hasRefGuardedReturn) return;
    if (isFunctionLikeNode(child)) return false;
    if (!isNodeOfType(child, "IfStatement")) return;
    if (!child.test || !nodeReadsRefCurrent(child.test)) return;
    if (child.consequent && containsReturnStatement(child.consequent)) {
      hasRefGuardedReturn = true;
    }
  });
  return hasRefGuardedReturn;
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
      /^set[A-Z]/.test(child.callee.name) &&
      isUseStateSetterInScope(child, child.callee.name) &&
      !isConstantOnlyArgument(child.arguments?.[0])
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
export const rerenderTransitionsScroll = defineRule({
  id: "rerender-transitions-scroll",
  title: "setState in a scroll handler",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Wrap the setState in startTransition, use useDeferredValue, or keep the value in a ref and throttle with requestAnimationFrame, so these events don't redraw the screen every time",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isAddEventListenerCall(node)) return;
      const eventArg = node.arguments?.[0];
      if (!isNodeOfType(eventArg, "Literal")) return;
      const eventName = eventArg.value;
      if (typeof eventName !== "string" || !HIGH_FREQUENCY_DOM_EVENTS.has(eventName)) return;

      const handler = node.arguments?.[1];
      if (!handler) return;
      const setStateCall = handlerCallsSetState(handler);
      if (!setStateCall) return;
      if (handlerDeduplicatesViaRef(handler)) return;

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
        message: `This can make scrolling stutter because setState in a "${eventName}" handler redraws on every event. Wrap it in startTransition, use useDeferredValue, or keep the value in a ref and throttle with requestAnimationFrame.`,
      });
    },
  }),
});
