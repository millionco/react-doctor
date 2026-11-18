import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "../design/utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "../design/utils/get-style-property-string-value.js";

const GROWTH_CONFLICTING_TAILWIND_UTILITY = /^(?:(?:min-|max-)?(?:h|block)|size|aspect|contain)-/;
const GROWTH_CONFLICTING_STYLE_KEYS = new Set([
  "all",
  "aspectRatio",
  "aspect-ratio",
  "blockSize",
  "block-size",
  "contain",
  "containerType",
  "container-type",
  "contentVisibility",
  "content-visibility",
  "field-sizing",
  "height",
  "maxBlockSize",
  "max-block-size",
  "maxHeight",
  "max-height",
  "minBlockSize",
  "min-block-size",
  "minHeight",
  "min-height",
  "writingMode",
  "writing-mode",
]);

const hasConflictingContentSizingUtility = (className: string): boolean =>
  splitTailwindClassName(className).some((token) => {
    const { utility } = parseTailwindClassNameToken(token);
    return (
      utility.startsWith("[") ||
      GROWTH_CONFLICTING_TAILWIND_UTILITY.test(utility) ||
      (utility.startsWith("field-sizing-") && utility !== "field-sizing-content")
    );
  });

const hasClosedInlineSizing = (style: EsTreeNodeOfType<"ObjectExpression">): boolean =>
  style.properties.every((property) => {
    const key = getStylePropertyKey(property);
    return (
      key !== null &&
      !GROWTH_CONFLICTING_STYLE_KEYS.has(key) &&
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.value, "Literal")
    );
  });

export const noNonresizableTextarea = defineRule({
  id: "no-nonresizable-textarea",
  title: "Textarea resizing is disabled",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Let users resize multiline fields in at least the block direction unless the control grows automatically with its content.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "textarea" || hasJsxSpreadAttribute(node.attributes))
        return;
      const className = getStringFromClassNameAttr(node);
      const classNameTokens = className ? getUnvariantClassNameTokens(className) : [];
      const hasResizeNoneClass =
        classNameTokens.includes("resize-none") &&
        !classNameTokens.includes("field-sizing-content");
      const styleAttribute = findJsxAttribute(node.attributes, "style");
      const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
      const resizeProperty = expression
        ? getEffectiveStyleProperty(expression.properties, "resize")
        : null;
      const fieldSizingProperty = expression
        ? getEffectiveStyleProperty(expression.properties, "fieldSizing")
        : null;
      const hasInlineContentSizing =
        fieldSizingProperty && getStylePropertyStringValue(fieldSizingProperty) === "content";
      const hasInlineResizeNone = Boolean(
        resizeProperty &&
        getStylePropertyStringValue(resizeProperty) === "none" &&
        !hasInlineContentSizing,
      );
      if (!hasResizeNoneClass && !hasInlineResizeNone) return;

      const hasMixedContentSizing =
        (classNameTokens.includes("resize-none") && hasInlineContentSizing) ||
        (classNameTokens.includes("field-sizing-content") &&
          hasInlineResizeNone &&
          !fieldSizingProperty);
      if (
        hasMixedContentSizing &&
        className &&
        // Static class templates are read in their raw form.
        !className.includes("\\") &&
        !/[^\S \t\n\r\f]/.test(className) &&
        expression &&
        styleAttribute === getAuthoritativeJsxAttribute(node.attributes, "style") &&
        !hasConflictingContentSizingUtility(className) &&
        hasClosedInlineSizing(expression)
      ) {
        return;
      }

      const reportNode: EsTreeNode = resizeProperty ?? node;
      if (!isNodeOfType(reportNode, "Property") && !isNodeOfType(reportNode, "JSXOpeningElement"))
        return;
      context.report({
        node: reportNode,
        message:
          "This textarea disables user resizing, which can make long input difficult to review. Allow vertical or block-axis resizing unless the field auto-grows.",
      });
    },
  }),
});
