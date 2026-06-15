import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// An UNPREFIXED `fill-*` / `stroke-*` utility that sets an explicit COLOR (so
// it fights an inline `fill="currentColor"` / `stroke="currentColor"`).
// Excludes:
//   - variant-prefixed tokens (`hover:fill-blue-600`, `dark:fill-white`) — the
//     attribute paints the base color; the class only applies in that state, so
//     there's no static conflict;
//   - `*-current` (inherits the text color — the intended pairing);
//   - stroke-WIDTH utilities (`stroke-2`, `stroke-[1.5]`), which set thickness.
const hasColorUtility = (classNameValue: string, prefix: "fill-" | "stroke-"): boolean =>
  classNameValue.split(/\s+/).some((token) => {
    if (token.includes(":")) return false;
    if (!token.startsWith(prefix)) return false;
    const value = token.slice(prefix.length);
    if (value === "" || value === "current") return false;
    if (/^\d/.test(value) || /^\[\d/.test(value)) return false;
    return true;
  });

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

      for (const paint of ["fill", "stroke"] as const) {
        const attribute = findJsxAttribute(node.attributes, paint);
        if (
          attribute &&
          isCurrentColor(attribute) &&
          hasColorUtility(classNameValue, `${paint}-`)
        ) {
          context.report({
            node: attribute,
            message: `\`${paint}="currentColor"\` and a \`${paint}-*\` color class on the same element conflict — the class wins. Remove one, or use \`${paint}-current\` to inherit the text color.`,
          });
          return;
        }
      }
    },
  }),
});
