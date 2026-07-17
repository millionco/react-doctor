import { COMMON_UI_FONT_FAMILIES } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const ROOT_LAYOUT_CLASS_NAMES = new Set(["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"]);
const COMMON_FONT_CLASS_NAMES = new Set([
  "font-sans",
  ...[...COMMON_UI_FONT_FAMILIES].map((fontFamily) => `font-${fontFamily.replace(/\s+/g, "-")}`),
]);

const isPageRoot = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "main") return true;
  const classNameValue = getStringFromClassNameAttr(node);
  return Boolean(
    classNameValue &&
    getUnvariantClassNameTokens(classNameValue).some((token) => ROOT_LAYOUT_CLASS_NAMES.has(token)),
  );
};

export const noCommonRootFont = defineRule({
  id: "no-common-root-font",
  title: "Page root uses a generic default font choice",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Choose a typeface that supports the product's voice, or document why the conventional UI font is intentional.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isPageRoot(node)) return;
      const classNameValue = getStringFromClassNameAttr(node);
      const commonFontClass = classNameValue
        ? getUnvariantClassNameTokens(classNameValue).find((token) =>
            COMMON_FONT_CLASS_NAMES.has(token),
          )
        : undefined;
      if (commonFontClass) {
        context.report({
          node,
          message: `The page root explicitly selects ${commonFontClass}. Choose typography that contributes a more specific voice.`,
        });
        return;
      }
      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        const property = getEffectiveStyleProperty(styleExpression.properties, "fontFamily");
        if (!property) continue;
        const fontFamilyValue = getStylePropertyStringValue(property);
        if (!fontFamilyValue || fontFamilyValue.includes("var(")) continue;
        const primaryFont = fontFamilyValue
          .split(",")[0]
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .toLowerCase();
        if (!COMMON_UI_FONT_FAMILIES.has(primaryFont)) continue;
        context.report({
          node: property,
          message: `The page root defaults to ${primaryFont}, a very common UI font. Choose typography that contributes a more specific voice.`,
        });
      }
    },
  }),
});
