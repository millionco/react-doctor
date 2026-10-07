import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isR3fUseThreeStateProperty } from "./utils/is-r3f-use-three-state-property.js";
import { resolveGlobalResizeHandler } from "./utils/resolve-global-resize-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

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

const reportManualResize = (handler: EsTreeNode | null, context: RuleContext): void => {
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
      reportManualResize(resolveGlobalResizeHandler(node, context), context);
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      reportManualResize(resolveGlobalResizeHandler(node, context), context);
    },
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      reportManualResize(resolveGlobalResizeHandler(node, context), context);
    },
  }),
});
