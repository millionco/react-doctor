import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getStaticNumberArray } from "./utils/get-static-number-array.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isValidShadowMapSize } from "./utils/is-valid-shadow-map-size.js";
import { readStaticJsxBooleanAttribute } from "./utils/read-static-jsx-boolean-attribute.js";

const R3F_SHADOW_CASTING_LIGHT_NAMES: ReadonlySet<string> = new Set([
  "directionalLight",
  "pointLight",
  "spotLight",
]);

const reportInvalidSize = (expression: EsTreeNode, context: RuleContext): void => {
  const value = getStaticNumber(expression, context.scopes);
  if (value === null || isValidShadowMapSize(value)) return;
  context.report({
    node: expression,
    message: `Shadow map size ${String(value)} is invalid; Three.js shadow map dimensions must be positive powers of two`,
  });
};

export const r3fValidShadowMapSize = defineRule({
  id: "r3f-valid-shadow-map-size",
  title: "Invalid R3F shadow map size",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use positive power-of-two shadow map dimensions within the renderer's maximum texture size",
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
          !R3F_SHADOW_CASTING_LIGHT_NAMES.has(node.name.name) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const castShadowAttribute = getAuthoritativeJsxAttribute(node.attributes, "castShadow");
        if (!castShadowAttribute || readStaticJsxBooleanAttribute(castShadowAttribute) !== true)
          return;
        const mapSizeExpression = getJsxAttributeExpression(node, "shadow-mapSize");
        if (mapSizeExpression) {
          const values = getStaticNumberArray(mapSizeExpression, context.scopes);
          if (values) {
            for (const value of values.slice(0, 2)) {
              if (isValidShadowMapSize(value)) continue;
              context.report({
                node: mapSizeExpression,
                message: `Shadow map size ${String(value)} is invalid; Three.js shadow map dimensions must be positive powers of two`,
              });
            }
          }
        }
        const widthExpression = getJsxAttributeExpression(node, "shadow-mapSize-width");
        const heightExpression = getJsxAttributeExpression(node, "shadow-mapSize-height");
        if (widthExpression) reportInvalidSize(widthExpression, context);
        if (heightExpression) reportInvalidSize(heightExpression, context);
      },
    };
  },
});
