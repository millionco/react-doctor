import { TINY_TEXT_THRESHOLD_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;

const collectStaticExpressionText = (node: EsTreeNode | null | undefined): string => {
  if (!node) return "";
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "string" ? node.value : "";
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.quasis ?? []).map((quasi) => quasi.value?.raw ?? "").join("");
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      collectStaticExpressionText(node.consequent) + collectStaticExpressionText(node.alternate)
    );
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return collectStaticExpressionText(node.right);
  }
  return "";
};

// Decorative glyph content (sort arrows `▲`/`▼`, `×` close marks, `#`
// column headers) is sized with fontSize but is not text users read.
const hasGlyphOnlyContent = (styleAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const jsxElement = styleAttribute.parent?.parent;
  if (!isNodeOfType(jsxElement, "JSXElement")) return false;
  let staticText = "";
  for (const child of jsxElement.children ?? []) {
    if (isNodeOfType(child, "JSXText")) {
      staticText += typeof child.value === "string" ? child.value : "";
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      staticText += collectStaticExpressionText(child.expression);
    }
  }
  const trimmedText = staticText.trim();
  return trimmedText.length > 0 && !LETTER_OR_DIGIT_PATTERN.test(trimmedText);
};

// Uppercase tracked micro-labels (overlines / eyebrow headers) are a
// deliberate design pattern, not body text — uppercase glyphs read
// larger than lowercase at the same px size.
const isUppercaseMicroLabel = (expression: EsTreeNodeOfType<"ObjectExpression">): boolean =>
  (expression.properties ?? []).some(
    (property) =>
      getStylePropertyKey(property) === "textTransform" &&
      getStylePropertyStringValue(property) === "uppercase",
  );

export const noTinyText = defineRule({
  id: "no-tiny-text",
  title: "Text is too small",
  severity: "warn",
  tags: ["test-noise"],
  category: "Accessibility",
  recommendation:
    "Use at least 12px for body text, and 16px is best. Small text is hard to read, especially on phones.",
  create: (context: RuleContext) => {
    const reportedPxValues = new Set<number>();
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const expression = getInlineStyleExpression(node);
        if (!expression) return;

        for (const property of expression.properties ?? []) {
          const key = getStylePropertyKey(property);
          if (key !== "fontSize") continue;

          let pxValue: number | null = null;
          const numValue = getStylePropertyNumberValue(property);
          const strValue = getStylePropertyStringValue(property);

          if (numValue !== null) {
            pxValue = numValue;
          } else if (strValue !== null) {
            const pxMatch = strValue.match(/^([\d.]+)px$/);
            if (pxMatch) pxValue = parseFloat(pxMatch[1]);
            const remMatch = strValue.match(/^([\d.]+)rem$/);
            if (remMatch) pxValue = parseFloat(remMatch[1]) * 16;
          }

          if (pxValue === null || pxValue <= 0 || pxValue >= TINY_TEXT_THRESHOLD_PX) continue;
          if (reportedPxValues.has(pxValue)) continue;
          if (isUppercaseMicroLabel(expression)) continue;
          if (hasGlyphOnlyContent(node)) continue;

          reportedPxValues.add(pxValue);
          context.report({
            node: property,
            message: `Your users strain to read ${pxValue}px text, so use at least ${TINY_TEXT_THRESHOLD_PX}px for body text, & 16px is best.`,
          });
        }
      },
    };
  },
});
