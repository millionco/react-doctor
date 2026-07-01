import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const ACCESSIBLE_NAME_ATTRIBUTES = new Set(["aria-label", "aria-labelledby"]);

const isEmptyStringLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === "";

// Only fires on values that STATICALLY collapse to the empty string: a
// literal `""`, a `??`/`||` fallback whose right operand is `""`, or a
// ternary with an empty-string branch. Identifiers, calls, and non-empty
// templates carry a real (or unknown) name and stay quiet.
const resolvesToEmptyAccessibleName = (valueNode: EsTreeNode): boolean => {
  const node = stripParenExpression(valueNode);
  if (isEmptyStringLiteral(node)) return true;
  if (
    isNodeOfType(node, "LogicalExpression") &&
    (node.operator === "??" || node.operator === "||")
  ) {
    return isEmptyStringLiteral(stripParenExpression(node.right));
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      isEmptyStringLiteral(stripParenExpression(node.consequent)) ||
      isEmptyStringLiteral(stripParenExpression(node.alternate))
    );
  }
  return false;
};

export const noEmptyAriaLabel = defineRule({
  id: "no-empty-aria-label",
  title: "Empty ARIA accessible name",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Give `aria-label`/`aria-labelledby` a non-empty value so the control has an accessible name for screen readers.",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const name = getJsxAttributeName(node.name);
      if (!name || !ACCESSIBLE_NAME_ATTRIBUTES.has(name.toLowerCase())) return;
      const value = node.value;
      if (!value) return;
      const target = isNodeOfType(value, "JSXExpressionContainer")
        ? value.expression
        : value;
      if (!target || !resolvesToEmptyAccessibleName(target)) return;
      context.report({
        node,
        message: `Screen reader users hear this control with no name because \`${name}\` resolves to an empty string, so give it a non-empty accessible name.`,
      });
    },
  }),
});
