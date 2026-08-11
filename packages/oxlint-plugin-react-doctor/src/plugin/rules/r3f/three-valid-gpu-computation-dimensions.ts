import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  GPU_COMPUTATION_HEIGHT_ARGUMENT_INDEX,
  GPU_COMPUTATION_WIDTH_ARGUMENT_INDEX,
  MINIMUM_GPU_COMPUTATION_DIMENSION_PX,
} from "./constants.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

export const threeValidGpuComputationDimensions = defineRule({
  id: "three-valid-gpu-computation-dimensions",
  title: "GPU computation has an invalid texture dimension",
  category: "Correctness",
  severity: "error",
  recommendation: "Use positive integer dimensions for GPU computation textures",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (getThreeConstructorName(node, context.scopes) !== "GPUComputationRenderer") return;
      const dimensions = [
        ["width", node.arguments[GPU_COMPUTATION_WIDTH_ARGUMENT_INDEX]],
        ["height", node.arguments[GPU_COMPUTATION_HEIGHT_ARGUMENT_INDEX]],
      ] as const;
      for (const [dimensionName, argument] of dimensions) {
        if (!argument || isNodeOfType(argument, "SpreadElement")) continue;
        const dimension = getStaticNumber(argument, context.scopes);
        if (
          dimension === null ||
          (Number.isInteger(dimension) && dimension >= MINIMUM_GPU_COMPUTATION_DIMENSION_PX)
        ) {
          continue;
        }
        context.report({
          node: argument,
          message: `GPUComputationRenderer ${dimensionName} must be a positive integer, but this value is ${String(dimension)}`,
        });
      }
    },
  }),
});
