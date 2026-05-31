import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  'Screen reader users hear "image" or "photo" twice because they already announce it, so describe what the image shows instead.';

const DEFAULT_COMPONENTS: ReadonlyArray<string> = ["img"];
const DEFAULT_REDUNDANT_WORDS: ReadonlyArray<string> = ["image", "photo", "picture"];

interface ImgRedundantAltSettings {
  components?: ReadonlyArray<string>;
  words?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { components: ReadonlyArray<string>; words: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { imgRedundantAlt?: ImgRedundantAltSettings }).imgRedundantAlt ?? {})
      : {};
  return {
    components: [...DEFAULT_COMPONENTS, ...(ruleSettings.components ?? [])],
    words: [...DEFAULT_REDUNDANT_WORDS, ...(ruleSettings.words ?? [])],
  };
};

const isWordBoundary = (text: string, start: number, end: number): boolean => {
  const isAlphanumeric = (charCode: number): boolean =>
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122);
  const startsBoundary = start === 0 || !isAlphanumeric(text.charCodeAt(start - 1));
  const endsBoundary = end === text.length || !isAlphanumeric(text.charCodeAt(end));
  return startsBoundary && endsBoundary;
};

const containsRedundantWord = (altText: string, words: ReadonlyArray<string>): boolean => {
  const lower = altText.toLowerCase();
  for (const word of words) {
    const lowerWord = word.toLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
      const index = lower.indexOf(lowerWord, cursor);
      if (index === -1) break;
      const end = index + lowerWord.length;
      if (isWordBoundary(lower, index, end)) return true;
      cursor = index + 1;
    }
  }
  return false;
};

const altValueRedundant = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  words: ReadonlyArray<string>,
): boolean => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return false;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
    return containsRedundantWord(value.value, words);
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return containsRedundantWord(expression.value, words);
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      // Each quasi piece is checked independently — matches OXC.
      return expression.quasis.some((quasi) => containsRedundantWord(quasi.value.raw, words));
    }
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::img_redundant_alt`.
export const imgRedundantAlt = defineRule<Rule>({
  id: "img-redundant-alt",
  title: "Redundant words in image alt",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Do not put 'image' or 'photo' in alt text. Describe what is shown.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tag = getElementType(node, context.settings);
        if (!settings.components.includes(tag)) return;
        if (isHiddenFromScreenReader(node, context.settings)) return;
        const altAttribute = hasJsxPropIgnoreCase(node.attributes, "alt");
        if (!altAttribute) return;
        if (altValueRedundant(altAttribute, settings.words)) {
          context.report({ node: altAttribute, message: MESSAGE });
        }
      },
    };
  },
});
