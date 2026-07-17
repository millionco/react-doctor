import { READABLE_LINE_LENGTH_MAX_CH } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const TEXT_ELEMENT_NAMES = new Set(["blockquote", "dd", "figcaption", "li", "p"]);
const CHARACTER_WIDTH_PATTERN = /^(?:max-)?w-\[([\d.]+)ch\]$/;

export const noOverwideTextMeasure = defineRule({
  id: "no-overwide-text-measure",
  title: "Text measure is too wide",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Accessibility",
  recommendation:
    "Constrain long-form text to a readable line length, usually between 60ch and 75ch.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || !TEXT_ELEMENT_NAMES.has(node.name.name)) {
        return;
      }

      const classNameValue = getStringFromClassNameAttr(node);
      if (classNameValue) {
        const overwideToken = getClassNameTokens(classNameValue).find((token) => {
          const match = token.match(CHARACTER_WIDTH_PATTERN);
          return match && parseFloat(match[1]) > READABLE_LINE_LENGTH_MAX_CH;
        });
        if (overwideToken) {
          context.report({
            node,
            message: `The explicit ${overwideToken} measure creates lines that are difficult to track. Keep body text at ${READABLE_LINE_LENGTH_MAX_CH}ch or less.`,
          });
          return;
        }
      }

      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        for (const propertyName of ["width", "maxWidth"]) {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          if (!property) continue;
          const propertyValue = getStylePropertyStringValue(property)?.trim();
          const match = propertyValue?.match(/^([\d.]+)ch$/);
          if (!match || parseFloat(match[1]) <= READABLE_LINE_LENGTH_MAX_CH) continue;
          context.report({
            node: property,
            message: `This ${match[1]}ch text measure is too wide for comfortable reading. Constrain it to ${READABLE_LINE_LENGTH_MAX_CH}ch or less.`,
          });
        }
      }
    },
  }),
});
