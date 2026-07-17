import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "../design/utils/get-style-property-string-value.js";

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
      const hasInlineResizeNone = Boolean(
        resizeProperty &&
        getStylePropertyStringValue(resizeProperty) === "none" &&
        (!fieldSizingProperty || getStylePropertyStringValue(fieldSizingProperty) !== "content"),
      );
      if (!hasResizeNoneClass && !hasInlineResizeNone) return;
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
