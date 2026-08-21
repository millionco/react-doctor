import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  DEFAULT_FOG_FAR,
  DEFAULT_FOG_NEAR,
  FOG_EXPONENTIAL_DENSITY_ARGUMENT_INDEX,
  FOG_FAR_ARGUMENT_INDEX,
  FOG_NEAR_ARGUMENT_INDEX,
} from "./constants.js";
import { getInvalidFogParameter } from "./utils/get-invalid-fog-parameter.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

export const threeValidFogParameters = defineRule({
  id: "three-valid-fog-parameters",
  title: "Three.js fog has invalid range parameters",
  category: "Correctness",
  severity: "error",
  recommendation: "Use non-negative fog parameters and keep linear fog far greater than near",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const constructorName = getThreeConstructorName(node, context.scopes);
      if (constructorName !== "Fog" && constructorName !== "FogExp2") return;
      const densityExpression = node.arguments[FOG_EXPONENTIAL_DENSITY_ARGUMENT_INDEX];
      const nearExpression = node.arguments[FOG_NEAR_ARGUMENT_INDEX];
      const farExpression = node.arguments[FOG_FAR_ARGUMENT_INDEX];
      const density =
        densityExpression && densityExpression.type !== "SpreadElement"
          ? getStaticNumber(densityExpression, context.scopes)
          : null;
      const near =
        nearExpression && nearExpression.type !== "SpreadElement"
          ? getStaticNumber(nearExpression, context.scopes)
          : DEFAULT_FOG_NEAR;
      const far =
        farExpression && farExpression.type !== "SpreadElement"
          ? getStaticNumber(farExpression, context.scopes)
          : DEFAULT_FOG_FAR;
      const invalidParameter = getInvalidFogParameter({
        constructorName,
        density: density ?? undefined,
        far: far ?? undefined,
        near: near ?? undefined,
      });
      if (!invalidParameter) return;
      context.report({
        node,
        message: `${constructorName} ${invalidParameter}, otherwise the fog attenuation is invalid`,
      });
    },
  }),
});
