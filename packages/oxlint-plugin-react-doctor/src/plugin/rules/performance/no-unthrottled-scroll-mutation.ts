import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isGlobalAnimationFrameCallee } from "../../utils/is-global-animation-frame-callee.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ANIMATED_STYLE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "backdrop-filter",
  "backdropFilter",
  "bottom",
  "filter",
  "height",
  "left",
  "opacity",
  "right",
  "rotate",
  "scale",
  "top",
  "transform",
  "translate",
  "width",
]);

const SCHEDULER_GUARD_NODE_TYPES: ReadonlySet<string> = new Set([
  "ConditionalExpression",
  "IfStatement",
  "LogicalExpression",
  "SwitchStatement",
]);

const getOutermostMemberReceiver = (memberExpression: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(memberExpression, "MemberExpression")) return null;
  let receiver = memberExpression.object;
  while (isNodeOfType(receiver, "MemberExpression")) receiver = receiver.object;
  return receiver;
};

const memberChainContainsProperty = (
  memberExpression: EsTreeNode,
  propertyName: string,
): boolean => {
  let current: EsTreeNode | null = memberExpression;
  while (current && isNodeOfType(current, "MemberExpression")) {
    if (getStaticPropertyName(current) === propertyName) return true;
    current = current.object;
  }
  return false;
};

const isDirectAnimationFrameCallback = (
  callback: EsTreeNode,
  scrollHandler: EsTreeNode,
  context: RuleContext,
): boolean => {
  const callExpression = callback.parent;
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  if (callExpression.arguments?.[0] !== callback) return false;
  if (!isGlobalAnimationFrameCallee(callExpression.callee, context.scopes)) return false;
  let ancestor = callExpression.parent;
  while (ancestor && ancestor !== scrollHandler) {
    if (SCHEDULER_GUARD_NODE_TYPES.has(ancestor.type)) return false;
    ancestor = ancestor.parent;
  }
  return true;
};

const findScrollDrivenAnimationMutation = (
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  let mutation: EsTreeNode | null = null;
  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (mutation) return false;
    if (
      child !== functionNode.body &&
      isFunctionLike(child) &&
      !isDirectAnimationFrameCallback(child, functionNode, context)
    ) {
      return false;
    }

    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression")
    ) {
      const isDomPropertyWrite =
        memberChainContainsProperty(child.left, "style") &&
        ANIMATED_STYLE_PROPERTY_NAMES.has(getStaticPropertyName(child.left) ?? "");
      const receiver = getOutermostMemberReceiver(child.left);
      if (
        isDomPropertyWrite &&
        receiver &&
        isProvenBrowserApiReceiver(receiver, "dom-event-target", context.scopes)
      ) {
        mutation = child;
        return false;
      }
    }

    if (!isNodeOfType(child, "CallExpression") || !isNodeOfType(child.callee, "MemberExpression")) {
      return;
    }
    const methodName = getStaticPropertyName(child.callee);
    if (!methodName) return;
    const methodReceiver = child.callee.object;
    if (methodName === "animate") {
      if (isProvenBrowserApiReceiver(methodReceiver, "dom-event-target", context.scopes)) {
        mutation = child;
        return false;
      }
      return;
    }
    if (methodName !== "setProperty" || !isNodeOfType(methodReceiver, "MemberExpression")) {
      return;
    }
    if (getStaticPropertyName(methodReceiver) !== "style") return;
    const propertyArgument = child.arguments?.[0];
    if (
      !isNodeOfType(propertyArgument, "Literal") ||
      typeof propertyArgument.value !== "string" ||
      !ANIMATED_STYLE_PROPERTY_NAMES.has(propertyArgument.value)
    ) {
      return;
    }
    const receiver = getOutermostMemberReceiver(methodReceiver);
    if (receiver && isProvenBrowserApiReceiver(receiver, "dom-event-target", context.scopes)) {
      mutation = child;
      return false;
    }
  });
  return mutation;
};

export const noUnthrottledScrollMutation = defineRule({
  id: "no-unthrottled-scroll-mutation",
  title: "Scroll handler drives animation every event",
  severity: "warn",
  recommendation:
    "Use a scroll or view timeline, IntersectionObserver, or a real timer throttle so animation work does not run for every scroll event.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "addEventListener") return;
      if (!isProvenBrowserApiReceiver(node.callee.object, "dom-event-target", context.scopes))
        return;
      const eventName = node.arguments?.[0];
      if (!isNodeOfType(eventName, "Literal") || eventName.value !== "scroll") return;
      const handlerExpression = node.arguments?.[1];
      if (!handlerExpression) return;
      const handler = resolveExactLocalFunction(handlerExpression, context.scopes);
      if (!handler) return;
      const mutation = findScrollDrivenAnimationMutation(handler, context);
      if (!mutation) return;

      context.report({
        node: mutation,
        message:
          "This drives animation work from every scroll event, which can make scrolling jank. Use a scroll timeline, IntersectionObserver, or a real timer throttle.",
      });
    },
  }),
});
