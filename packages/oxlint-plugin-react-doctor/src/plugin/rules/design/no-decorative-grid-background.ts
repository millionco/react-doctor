import { DECORATIVE_GRID_MIN_GRADIENT_LAYERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { isDataVisualizationContext } from "./utils/is-data-visualization-context.js";

const isDecorativeGridValue = (value: string): boolean => {
  const nonRepeatingValue = value.replace(/repeating-linear-gradient/gi, "");
  const gradientLayerCount = [...nonRepeatingValue.matchAll(/linear-gradient\(/gi)].length;
  return (
    gradientLayerCount >= DECORATIVE_GRID_MIN_GRADIENT_LAYERS &&
    /(?:^|[^\d.])1px(?:[^\d.]|$)/i.test(value) &&
    /transparent/i.test(value)
  );
};

export const noDecorativeGridBackground = defineRule({
  id: "no-decorative-grid-background",
  title: "Surface draws a decorative grid background",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reserve coordinate grids for data or spatial interfaces; use a quieter surface for decoration.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isDataVisualizationContext(node, context.filename)) return;
      const classNameValue = getStringFromClassNameAttr(node);
      if (classNameValue && isDecorativeGridValue(classNameValue)) {
        context.report({
          node,
          message:
            "This layered one-pixel grid is decorative rather than functional. Simplify the surface or tie the grid to spatial content.",
        });
        return;
      }
      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        for (const propertyName of ["background", "backgroundImage"]) {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          if (!property) continue;
          const propertyValue = getStylePropertyStringValue(property);
          if (!propertyValue || !isDecorativeGridValue(propertyValue)) continue;
          context.report({
            node: property,
            message:
              "This background draws a decorative coordinate grid. Use it only when the grid conveys spatial information.",
          });
        }
      }
    },
  }),
});
