import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isValidShadowMapSize } from "./utils/is-valid-shadow-map-size.js";

const SHADOW_CASTING_LIGHT_NAMES: ReadonlySet<string> = new Set([
  "DirectionalLight",
  "PointLight",
  "SpotLight",
]);

const getShadowLightExpression = (expression: EsTreeNode): EsTreeNode | null => {
  const mapSizeMember = stripParenExpression(expression);
  if (
    !isNodeOfType(mapSizeMember, "MemberExpression") ||
    getStaticPropertyName(mapSizeMember) !== "mapSize"
  ) {
    return null;
  }
  const shadowMember = stripParenExpression(mapSizeMember.object);
  return isNodeOfType(shadowMember, "MemberExpression") &&
    getStaticPropertyName(shadowMember) === "shadow"
    ? shadowMember.object
    : null;
};

const reportInvalidSize = (expression: EsTreeNode, context: RuleContext): void => {
  const value = getStaticNumber(expression, context.scopes);
  if (value === null || isValidShadowMapSize(value)) return;
  context.report({
    node: expression,
    message: `Shadow map size ${String(value)} is invalid; Three.js shadow map dimensions must be positive powers of two`,
  });
};

export const threeValidShadowMapSize = defineRule({
  id: "three-valid-shadow-map-size",
  title: "Invalid Three.js shadow map size",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Use positive power-of-two shadow map dimensions within the renderer's maximum texture size",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);
      if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "set") {
        return;
      }
      const lightExpression = getShadowLightExpression(callee.object);
      if (
        !lightExpression ||
        !SHADOW_CASTING_LIGHT_NAMES.has(
          getThreeConstructorName(lightExpression, context.scopes) ?? "",
        )
      ) {
        return;
      }
      const width = node.arguments[0];
      const height = node.arguments[1];
      if (width && !isNodeOfType(width, "SpreadElement")) reportInvalidSize(width, context);
      if (height && !isNodeOfType(height, "SpreadElement")) reportInvalidSize(height, context);
    },
  }),
});
