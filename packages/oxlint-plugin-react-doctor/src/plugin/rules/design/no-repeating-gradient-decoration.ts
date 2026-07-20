import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { isDataVisualizationContext } from "./utils/is-data-visualization-context.js";

const REPEATING_GRADIENT_PATTERN = /repeating-(?:linear|radial|conic)-gradient\(/i;

export const noRepeatingGradientDecoration = defineRule({
  id: "no-repeating-gradient-decoration",
  title: "Surface uses a repeating gradient texture",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use a deliberate texture asset or a quiet solid surface instead of repeating-gradient decoration.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isDataVisualizationContext(node, context.filename)) return;
      const classNameValue = getStringFromClassNameAttr(node);
      if (classNameValue && REPEATING_GRADIENT_PATTERN.test(classNameValue)) {
        context.report({
          node,
          message:
            "This arbitrary repeating gradient acts as generic surface decoration. Replace it with a deliberate texture or plain fill.",
        });
      }
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        for (const propertyName of ["background", "backgroundImage"]) {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          if (!property) continue;
          const propertyValue = getStylePropertyStringValue(property);
          if (!propertyValue || !REPEATING_GRADIENT_PATTERN.test(propertyValue)) continue;
          context.report({
            node: property,
            message:
              "This repeating gradient creates a generic decorative texture. Use a purposeful asset or simplify the surface.",
          });
        }
      }
    },
  }),
});
