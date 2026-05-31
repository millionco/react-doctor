import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NUMERIC_NAME_HINTS = ["count", "length", "total", "size", "num"];

// HACK: word-boundary aware to avoid false positives like `discount` /
// `account` matching "count" or `strength` matching "length". The hint
// must be either the entire identifier OR appear at the end with a
// case/underscore boundary (`userCount`, `user_count`, `USER_COUNT`).
const isNumericName = (name: string): boolean => {
  for (const hint of NUMERIC_NAME_HINTS) {
    if (name === hint) return true;
    const camelSuffix = hint.charAt(0).toUpperCase() + hint.slice(1);
    if (name.endsWith(camelSuffix)) return true;
    if (name.endsWith(`_${hint}`)) return true;
    if (name.endsWith(`_${hint.toUpperCase()}`)) return true;
  }
  return false;
};

export const renderingConditionalRender = defineRule<Rule>({
  id: "rendering-conditional-render",
  title: "Number before && renders stray 0",
  severity: "warn",
  recommendation:
    "Use `{items.length > 0 && <List />}`, or a ternary like `{items.length ? <List /> : null}`.",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "&&") return;

      const isRightJsx =
        isNodeOfType(node.right, "JSXElement") || isNodeOfType(node.right, "JSXFragment");
      if (!isRightJsx) return;

      const left = node.left;
      if (!left) return;

      const isLengthMemberAccess =
        isNodeOfType(left, "MemberExpression") &&
        isNodeOfType(left.property, "Identifier") &&
        left.property.name === "length";

      const isNumericIdentifier = isNodeOfType(left, "Identifier") && isNumericName(left.name);

      if (isLengthMemberAccess || isNumericIdentifier) {
        context.report({
          node,
          message:
            "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
        });
      }
    },
  }),
});
