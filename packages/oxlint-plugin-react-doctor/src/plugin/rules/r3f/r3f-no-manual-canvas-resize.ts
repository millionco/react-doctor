import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isR3fUseThreeStateProperty } from "./utils/is-r3f-use-three-state-property.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const isGlobalWindowResizeListener = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "addEventListener"
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  const eventName = call.arguments[0];
  return Boolean(
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    context.scopes.isGlobalReference(receiver) &&
    isNodeOfType(eventName, "Literal") &&
    eventName.value === "resize",
  );
};

const isGlobalWindowResizeAssignment = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): boolean => {
  if (assignment.operator !== "=") return false;
  const target = stripParenExpression(assignment.left);
  if (!isNodeOfType(target, "MemberExpression") || getStaticPropertyName(target) !== "onresize") {
    return false;
  }
  const receiver = stripParenExpression(target.object);
  return Boolean(
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    context.scopes.isGlobalReference(receiver),
  );
};

const isGlobalResizeObserverConstruction = (
  construction: EsTreeNodeOfType<"NewExpression">,
  context: RuleContext,
): boolean => {
  const constructor = stripParenExpression(construction.callee);
  return Boolean(
    isNodeOfType(constructor, "Identifier") &&
    constructor.name === "ResizeObserver" &&
    context.scopes.isGlobalReference(constructor),
  );
};

const findCanvasRendererSetSize = (
  callback: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let rendererSetSize: EsTreeNodeOfType<"CallExpression"> | null = null;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (
      rendererSetSize ||
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      getStaticPropertyName(candidate.callee) !== "setSize"
    ) {
      return;
    }
    if (
      isR3fUseThreeStateProperty(candidate.callee.object, "gl", context) ||
      isR3fUseThreeStateProperty(candidate.callee.object, "renderer", context)
    ) {
      rendererSetSize = candidate;
    }
  });
  return rendererSetSize;
};

const reportManualResize = (handlerExpression: EsTreeNode, context: RuleContext): void => {
  const handler = resolveExactLocalFunction(handlerExpression, context.scopes);
  if (!handler) return;
  const rendererSetSize = findCanvasRendererSetSize(handler, context);
  if (!rendererSetSize) return;
  context.report({
    node: rendererSetSize,
    message:
      "Canvas already observes its container and sizes this renderer. A second resize loop can duplicate work and fight the Canvas size lifecycle",
  });
};

export const r3fNoManualCanvasResize = defineRule({
  id: "r3f-no-manual-canvas-resize",
  title: "Manual resize loop for an R3F-owned renderer",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Let Canvas and its ResizeObserver own renderer sizing instead of registering a window resize loop",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isGlobalWindowResizeListener(node, context)) return;
      const handlerArgument = node.arguments[1];
      if (!handlerArgument || isNodeOfType(handlerArgument, "SpreadElement")) return;
      reportManualResize(handlerArgument, context);
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (!isGlobalWindowResizeAssignment(node, context)) return;
      reportManualResize(node.right, context);
    },
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (!isGlobalResizeObserverConstruction(node, context)) return;
      const handlerArgument = node.arguments[0];
      if (!handlerArgument || isNodeOfType(handlerArgument, "SpreadElement")) return;
      reportManualResize(handlerArgument, context);
    },
  }),
});
