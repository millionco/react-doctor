import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NON_COLOR_PAINT_VALUES = new Set(["current", "currentcolor", "none"]);
const NON_COLOR_PAINT_VALUE_PREFIXES = [
  "dasharray-",
  "dashoffset-",
  "linecap-",
  "linejoin-",
  "miterlimit-",
  "opacity-",
  "rule-",
  "width-",
];

const isPaintPropertyUtility = (utility: string, prefix: "fill-" | "stroke-"): boolean => {
  if (!utility.startsWith(prefix)) return false;
  const value = utility.slice(prefix.length);
  if (value === "") return false;
  if (NON_COLOR_PAINT_VALUE_PREFIXES.some((valuePrefix) => value.startsWith(valuePrefix))) {
    return false;
  }
  return !/^\d/.test(value) && !/^\[(?:\d|\.\d)/.test(value);
};

const isColorPaintUtility = (utility: string, prefix: "fill-" | "stroke-"): boolean => {
  if (!isPaintPropertyUtility(utility, prefix)) return false;
  const rawValue = utility.slice(prefix.length);
  const normalizedValue = rawValue
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();
  return !NON_COLOR_PAINT_VALUES.has(normalizedValue);
};

const hasColorUtility = (classNameValue: string, prefix: "fill-" | "stroke-"): boolean => {
  const effectiveUtility = getEffectiveTailwindClassNameToken(
    splitTailwindClassName(classNameValue),
    (utility) => isPaintPropertyUtility(utility, prefix),
  );
  return effectiveUtility !== null && isColorPaintUtility(effectiveUtility, prefix);
};

const isCurrentColor = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = getStringLiteralAttributeValue(attribute);
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
      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        node.name.name === "a" ||
        !SVG_TAGS.has(node.name.name)
      ) {
        return;
      }

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
