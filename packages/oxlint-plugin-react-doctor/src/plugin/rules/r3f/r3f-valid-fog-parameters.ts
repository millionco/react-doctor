import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  DEFAULT_FOG_FAR,
  DEFAULT_FOG_NEAR,
  FOG_EXPONENTIAL_DENSITY_ARGUMENT_INDEX,
  FOG_FAR_ARGUMENT_INDEX,
  FOG_NEAR_ARGUMENT_INDEX,
} from "./constants.js";
import { getInvalidFogParameter } from "./utils/get-invalid-fog-parameter.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getStaticNumberArrayElement } from "./utils/get-static-number-array-element.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

export const r3fValidFogParameters = defineRule({
  id: "r3f-valid-fog-parameters",
  title: "R3F fog has invalid range parameters",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Use non-negative fog parameters and keep linear fog far greater than near",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          (node.name.name !== "fog" && node.name.name !== "fogExp2")
        ) {
          return;
        }
        const constructorName = node.name.name === "fog" ? "Fog" : "FogExp2";
        const argumentExpression = getJsxAttributeExpression(node, "args");
        const densityExpression = getJsxAttributeExpression(node, "density");
        const nearExpression = getJsxAttributeExpression(node, "near");
        const farExpression = getJsxAttributeExpression(node, "far");
        const density = densityExpression
          ? getStaticNumber(densityExpression, context.scopes)
          : argumentExpression
            ? getStaticNumberArrayElement(
                argumentExpression,
                FOG_EXPONENTIAL_DENSITY_ARGUMENT_INDEX,
                context.scopes,
              )
            : undefined;
        const near = nearExpression
          ? getStaticNumber(nearExpression, context.scopes)
          : argumentExpression
            ? (getStaticNumberArrayElement(
                argumentExpression,
                FOG_NEAR_ARGUMENT_INDEX,
                context.scopes,
              ) ?? DEFAULT_FOG_NEAR)
            : DEFAULT_FOG_NEAR;
        const far = farExpression
          ? getStaticNumber(farExpression, context.scopes)
          : argumentExpression
            ? (getStaticNumberArrayElement(
                argumentExpression,
                FOG_FAR_ARGUMENT_INDEX,
                context.scopes,
              ) ?? DEFAULT_FOG_FAR)
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
    };
  },
});
