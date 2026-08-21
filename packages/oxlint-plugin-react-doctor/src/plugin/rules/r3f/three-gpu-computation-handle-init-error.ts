import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

const isDiscardedExpression = (node: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  if (
    expressionRoot.parent &&
    isNodeOfType(expressionRoot.parent, "ExpressionStatement") &&
    expressionRoot.parent.expression === expressionRoot
  ) {
    return true;
  }
  return Boolean(
    expressionRoot.parent &&
    isNodeOfType(expressionRoot.parent, "UnaryExpression") &&
    expressionRoot.parent.operator === "void",
  );
};

export const threeGpuComputationHandleInitError = defineRule({
  id: "three-gpu-computation-handle-init-error",
  title: "GPU computation initialization error is ignored",
  category: "Correctness",
  severity: "error",
  recommendation: "Check or propagate the error string returned by GPUComputationRenderer.init()",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "init" ||
        getThreeConstructorName(node.callee.object, context.scopes) !== "GPUComputationRenderer" ||
        !isDiscardedExpression(node)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "GPUComputationRenderer.init() returns null on success or an error string on failure, but this result is discarded",
      });
    },
  }),
});
