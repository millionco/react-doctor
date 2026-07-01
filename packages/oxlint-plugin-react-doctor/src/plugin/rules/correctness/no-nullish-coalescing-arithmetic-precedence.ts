import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ARITHMETIC_OPERATORS = new Set(["*", "/", "%", "-", "+"]);

// The intended fallback is the token immediately after `??`. When the
// right operand is a bare (unparenthesized) arithmetic expression whose
// leftmost leaf is a numeric literal, that literal got swallowed into the
// arithmetic: `x ?? 0 / y` parsed as `x ?? (0 / y)` rather than the
// intended `(x ?? 0) / y`. A leftmost identifier/member (e.g.
// `x ?? count - max`, `x ?? itemGap / 2`) is a legitimate computed
// default and stays quiet.
const leftmostLeafIsNumericLiteral = (node: EsTreeNode): boolean => {
  let current = node;
  while (isNodeOfType(current, "BinaryExpression")) {
    current = current.left as EsTreeNode;
  }
  return isNodeOfType(current, "Literal") && typeof current.value === "number";
};

export const noNullishCoalescingArithmeticPrecedence = defineRule({
  id: "no-nullish-coalescing-arithmetic-precedence",
  title: "Nullish coalescing swallowed by adjacent arithmetic",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Arithmetic binds tighter than `??`, so wrap the nullish part in parentheses (`(x ?? 0) / y`) to compute the value you actually intend.",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "??") return;
      const right = node.right as EsTreeNode;
      // Only a BARE arithmetic BinaryExpression — an explicitly
      // parenthesized right operand means the author disambiguated intent.
      if (!isNodeOfType(right, "BinaryExpression")) return;
      if (!ARITHMETIC_OPERATORS.has(right.operator)) return;
      if (!leftmostLeafIsNumericLiteral(right)) return;

      context.report({
        node,
        message:
          "Arithmetic binds tighter than `??`, so this runs as `x ?? (0 / y)` and divides the fallback instead of the value. Wrap the nullish part in parentheses like `(x ?? 0) / y`.",
      });
    },
  }),
});
