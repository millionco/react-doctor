import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A `fill-*` / `stroke-*` utility that is NOT `fill-current` / `stroke-current`
// — i.e. a class that sets an explicit color, which fights the inline
// `fill="currentColor"` / `stroke="currentColor"` attribute.
const CONFLICTING_FILL_CLASS = /(?:^|\s)fill-(?!current\b)/;
const CONFLICTING_STROKE_CLASS = /(?:^|\s)stroke-(?!current\b)/;

const isCurrentColor = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = getJsxPropStringValue(attribute);
  return value !== null && value.trim().toLowerCase() === "currentcolor";
};

export const noSvgCurrentcolorWithFillClass = defineRule({
  id: "no-svg-currentcolor-with-fill-class",
  title: "currentColor fights a fill/stroke class",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    'Pick one source of truth: drop the `fill="currentColor"` attribute and keep the `fill-*` class, or use `fill-current` to inherit the text color. Having both means the class silently wins.',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;

      const fillAttribute = findJsxAttribute(node.attributes, "fill");
      if (
        fillAttribute &&
        isCurrentColor(fillAttribute) &&
        CONFLICTING_FILL_CLASS.test(classNameValue)
      ) {
        context.report({
          node: fillAttribute,
          message:
            '`fill="currentColor"` and a `fill-*` color class on the same element conflict — the class wins. Remove one, or use `fill-current` to inherit the text color.',
        });
        return;
      }

      const strokeAttribute = findJsxAttribute(node.attributes, "stroke");
      if (
        strokeAttribute &&
        isCurrentColor(strokeAttribute) &&
        CONFLICTING_STROKE_CLASS.test(classNameValue)
      ) {
        context.report({
          node: strokeAttribute,
          message:
            '`stroke="currentColor"` and a `stroke-*` color class on the same element conflict — the class wins. Remove one, or use `stroke-current` to inherit the text color.',
        });
      }
    },
  }),
});
