import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getMotionReactApiPath } from "../../utils/get-motion-react-api-path.js";
import { getStaticArrayExpressionLength } from "../../utils/get-static-array-expression-length.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const motionUseTransformRangeLength = defineRule({
  id: "motion-use-transform-range-length",
  title: "Motion transform ranges have different lengths",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Give useTransform input and output ranges the same number of entries so every input stop has an output value.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (getMotionReactApiPath(node.callee, context.scopes) !== "useTransform") return;
      const inputLength = getStaticArrayExpressionLength(node.arguments[1]);
      const outputLength = getStaticArrayExpressionLength(node.arguments[2]);
      if (inputLength === null || outputLength === null || inputLength === outputLength) return;
      context.report({
        node,
        message: `useTransform receives ${inputLength} input stops but ${outputLength} output values. These ranges must have equal lengths.`,
      });
    },
  }),
});
