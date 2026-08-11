import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { DEFAULT_DATA_TEXTURE_DIMENSION_PX } from "./constants.js";
import { getDataTextureConstructorShape } from "./utils/get-data-texture-constructor-shape.js";
import { getStaticNumber } from "./utils/get-static-number.js";

export const threeValidDataTextureDimensions = defineRule({
  id: "three-valid-data-texture-dimensions",
  title: "Data texture has an invalid dimension",
  category: "Correctness",
  severity: "error",
  recommendation: "Use positive integer width, height, and depth values for data textures",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const texture = getDataTextureConstructorShape(node, context);
      if (!texture) return;
      const dimensions = [
        ["width", texture.width],
        ["height", texture.height],
        ["depth", texture.depth],
      ] as const;
      for (const [dimensionName, expression] of dimensions) {
        if (!expression) continue;
        const value = getStaticNumber(expression, context.scopes);
        if (
          value === null ||
          (Number.isInteger(value) && value >= DEFAULT_DATA_TEXTURE_DIMENSION_PX)
        ) {
          continue;
        }
        context.report({
          node: expression,
          message: `Data texture ${dimensionName} must be a positive integer, but this value is ${String(value)}`,
        });
      }
    },
  }),
});
