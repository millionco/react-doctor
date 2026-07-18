import { TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideExcludedTypographyAncestor } from "./utils/is-inside-excluded-typography-ancestor.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const USER_FACING_TEXT_ATTRIBUTE_NAMES = new Set(["alt", "aria-label", "placeholder", "title"]);

const getStaticAttributeText = (node: EsTreeNodeOfType<"JSXAttribute">): string | null => {
  const literalValue = getStringLiteralAttributeValue(node);
  if (literalValue !== null) return literalValue;
  const attributeValue = node.value;
  if (!attributeValue || !isNodeOfType(attributeValue, "JSXExpressionContainer")) return null;
  return isNodeOfType(attributeValue.expression, "TemplateLiteral")
    ? getStaticTemplateLiteralValue(attributeValue.expression)
    : null;
};

const reportStaticExpressionEllipses = (rawExpression: EsTreeNode, context: RuleContext): void => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) {
    if (
      typeof expression.value === "string" &&
      TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(expression.value)
    ) {
      context.report({
        node: expression,
        message: 'Use the real ellipsis character ("…") instead of three period characters.',
      });
    }
    return;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    if (staticValue && TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(staticValue)) {
      context.report({
        node: expression,
        message: 'Use the real ellipsis character ("…") instead of three period characters.',
      });
    }
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    reportStaticExpressionEllipses(expression.consequent, context);
    reportStaticExpressionEllipses(expression.alternate, context);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    reportStaticExpressionEllipses(expression.right, context);
  }
};

export const noThreePeriodEllipsis = defineRule({
  id: "design-no-three-period-ellipsis",
  title: "Three dots instead of ellipsis",
  tags: ["design", "test-noise"],
  severity: "warn",
  defaultEnabled: false,
  category: "Architecture",
  recommendation:
    'Use the real ellipsis character ("…") so UI labels look polished and consistent instead of like three separate periods.',
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const attributeName = getJsxAttributeName(node.name)?.toLowerCase();
      if (!attributeName || !USER_FACING_TEXT_ATTRIBUTE_NAMES.has(attributeName)) return;
      const textValue = getStaticAttributeText(node);
      if (!textValue || !TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(textValue)) return;
      context.report({
        node: node.value ?? node,
        message: 'Use the real ellipsis character ("…") instead of three period characters.',
      });
    },
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      if (node.parent && isNodeOfType(node.parent, "JSXAttribute")) return;
      if (isInsideExcludedTypographyAncestor(node)) return;
      reportStaticExpressionEllipses(node.expression, context);
    },
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(textValue)) return;
      if (isInsideExcludedTypographyAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message: 'Use the real ellipsis character ("…") instead of three period characters.',
      });
    },
  }),
});
