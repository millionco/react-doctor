import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isMaterialOpacityIgnored } from "./utils/is-material-opacity-ignored.js";
import { isThreeMaterialTransparentByDefault } from "./utils/is-three-material-transparent-by-default.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const readOptionalStaticBoolean = (
  expression: EsTreeNode | null | undefined,
): boolean | null | undefined =>
  expression === undefined ? undefined : readStaticBoolean(expression);

const readOptionalStaticNumber = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): number | null | undefined =>
  expression === undefined
    ? undefined
    : expression === null
      ? null
      : getStaticNumber(expression, context.scopes);

export const threeRequireTransparentForOpacity = defineRule({
  id: "three-require-transparent-for-opacity",
  title: "Three.js material opacity is ignored",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Enable transparent, alphaHash, or alphaTest when a material opacity below 1 should affect rendering",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const parameters = node.arguments[0];
      if (
        !provenance?.apiName.endsWith("Material") ||
        !isThreeModuleSource(provenance.moduleSource) ||
        isThreeMaterialTransparentByDefault(provenance.apiName) ||
        !parameters ||
        !isNodeOfType(parameters, "ObjectExpression") ||
        parameters.properties.some((property) => isNodeOfType(property, "SpreadElement"))
      ) {
        return;
      }
      const opacityExpression = getStaticObjectPropertyValue(parameters, "opacity");
      if (!opacityExpression) return;
      if (
        !isMaterialOpacityIgnored({
          alphaHash: readOptionalStaticBoolean(
            getStaticObjectPropertyValue(parameters, "alphaHash"),
          ),
          alphaTest: readOptionalStaticNumber(
            getStaticObjectPropertyValue(parameters, "alphaTest"),
            context,
          ),
          opacity: getStaticNumber(opacityExpression, context.scopes),
          transparent: readOptionalStaticBoolean(
            getStaticObjectPropertyValue(parameters, "transparent"),
          ),
        })
      ) {
        return;
      }
      context.report({
        node: opacityExpression,
        message:
          "This material sets opacity below 1 without transparent, alphaHash, or alphaTest, so the opacity does not make the surface translucent",
      });
    },
  }),
});
