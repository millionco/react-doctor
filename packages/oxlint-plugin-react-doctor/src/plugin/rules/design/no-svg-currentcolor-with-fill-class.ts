import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NON_COLOR_PAINT_VALUES = new Set(["current", "none"]);
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

const hasColorUtility = (classNameValue: string, prefix: "fill-" | "stroke-"): boolean =>
  classNameValue.split(/\s+/).some((token) => {
    const utility = getClassNameTokens(token)[0];
    const tokenWithoutImportantModifier = token.replace(/^!|!$/g, "");
    if (utility !== tokenWithoutImportantModifier || !utility.startsWith(prefix)) return false;
    const value = utility.slice(prefix.length);
    if (value === "" || NON_COLOR_PAINT_VALUES.has(value)) return false;
    if (NON_COLOR_PAINT_VALUE_PREFIXES.some((valuePrefix) => value.startsWith(valuePrefix))) {
      return false;
    }
    if (/^\d/.test(value) || /^\[(?:\d|\.\d)/.test(value)) return false;
    return true;
  });

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
