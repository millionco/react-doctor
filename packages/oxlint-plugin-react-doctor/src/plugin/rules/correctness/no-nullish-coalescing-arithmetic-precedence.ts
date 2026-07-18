import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const ARITHMETIC_OPERATORS = new Set(["*", "/", "%", "-", "+", "**"]);
const OPERATOR_DESCRIPTIONS = new Map([
  ["*", "multiplies"],
  ["/", "divides"],
  ["%", "applies remainder to"],
  ["-", "subtracts from"],
  ["+", "adds to"],
  ["**", "raises the fallback to"],
]);

const isNumericLiteralLeaf = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    (expression.operator === "-" || expression.operator === "+")
  ) {
    return isNumericLiteralLeaf(expression.argument as EsTreeNode);
  }
  return (
    isNodeOfType(expression, "Literal") &&
    (typeof expression.value === "number" || "bigint" in expression)
  );
};

const resolveNumericLeafValue = (node: EsTreeNode): number | null => {
  const expression = stripParenExpression(node);
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    (expression.operator === "-" || expression.operator === "+")
  ) {
    const innerValue = resolveNumericLeafValue(expression.argument as EsTreeNode);
    if (innerValue === null) return null;
    return expression.operator === "-" ? -innerValue : innerValue;
  }
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
    return expression.value;
  }
  if (isNodeOfType(expression, "Literal") && "bigint" in expression && expression.bigint) {
    const value = Number(expression.bigint);
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
};

// The intended fallback is the token immediately after `??`. When the
// right operand is a bare (unparenthesized) arithmetic expression whose
// leftmost leaf is a SENTINEL numeric literal, that literal got swallowed
// into the arithmetic: `x ?? 0 / y` parsed as `x ?? (0 / y)` rather than
// the intended `(x ?? 0) / y`. Sentinel means the as-parsed expression is
// degenerate — `0 <op> y` (annihilation/identity), `-1 - y` (the indexOf
// sentinel), `1 * y` (identity) — which no one writes deliberately. Any
// other leftmost literal is a scaled-constant fallback the author meant
// as-parsed (`x ?? 5 * MINUTE_MS`, `x ?? 1 / columnCount`,
// `x ?? 100 - successRate`, `x ?? 2 * Math.PI`) and stays quiet, as does
// a leftmost identifier/member (`x ?? count - max`, `x ?? itemGap / 2`).
const isSentinelLiteralSwallow = (node: EsTreeNodeOfType<"BinaryExpression">): boolean => {
  let innermost = node;
  while (isNodeOfType(stripParenExpression(innermost.left as EsTreeNode), "BinaryExpression")) {
    innermost = stripParenExpression(
      innermost.left as EsTreeNode,
    ) as EsTreeNodeOfType<"BinaryExpression">;
  }
  const leftmostValue = resolveNumericLeafValue(innermost.left as EsTreeNode);
  if (leftmostValue === null) return false;
  if (leftmostValue === 0) return true;
  // `-1` is the indexOf sentinel only under `-` (the sort-comparator
  // swallow); `-1 * gutter` is the explicit negation spelling of `-gutter`.
  if (leftmostValue === -1) return innermost.operator === "-";
  return leftmostValue === 1 && innermost.operator === "*";
};

// `x ?? 0 - someCall()` is the negation-fallback idiom: `0 - fn()` is a
// deliberate spelling of `-fn()` (observed as
// `offset ?? 0 - date.getTimezoneOffset()` in production timezone math), so
// the as-parsed grouping is what the author wants. The exemption is limited to
// `getTimezoneOffset()`; arbitrary call subtrahends still carry ambiguous grouping.
const isZeroMinusTimezoneOffsetIdiom = (node: EsTreeNodeOfType<"BinaryExpression">): boolean => {
  if (node.operator !== "-") return false;
  if (!isNodeOfType(node.left, "Literal") || node.left.value !== 0) return false;
  const subtrahend = node.right as EsTreeNode;
  if (!isNodeOfType(subtrahend, "CallExpression")) return false;
  const callee = subtrahend.callee as EsTreeNode;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "getTimezoneOffset"
  );
};

const hasStringLiteralLeaf = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return typeof expression.value === "string";
  if (!isNodeOfType(expression, "BinaryExpression") || expression.operator !== "+") return false;
  return (
    hasStringLiteralLeaf(expression.left as EsTreeNode) ||
    hasStringLiteralLeaf(expression.right as EsTreeNode)
  );
};

// A fully-constant fallback (`x ?? 100 * 1024 * 1024`, `x ?? 60 * 1000`)
// evaluates to a fixed value regardless of precedence — the swallowed-fallback
// bug needs an identifier/member operand in the arithmetic.
const hasNonNumericLiteralLeaf = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "BinaryExpression")) {
    return (
      hasNonNumericLiteralLeaf(expression.left as EsTreeNode) ||
      hasNonNumericLiteralLeaf(expression.right as EsTreeNode)
    );
  }
  return !isNumericLiteralLeaf(expression);
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
      // Both oxlint and the test harness parse with `preserveParens: false`,
      // so `x ?? (0 / y)` carries no ParenthesizedExpression node — but the
      // closing paren keeps the right operand's range from reaching the end
      // of the enclosing expression, which is the positional tell.
      if (!isNodeOfType(right, "BinaryExpression")) return;
      if (node.range && right.range && node.range[1] !== right.range[1]) return;
      if (!ARITHMETIC_OPERATORS.has(right.operator)) return;
      if (!isSentinelLiteralSwallow(right)) return;
      if (!hasNonNumericLiteralLeaf(right)) return;
      if (right.operator === "+" && hasStringLiteralLeaf(right)) return;
      if (isZeroMinusTimezoneOffsetIdiom(right)) return;

      context.report({
        node,
        message: `Arithmetic binds tighter than \`??\`, so this ${OPERATOR_DESCRIPTIONS.get(right.operator) ?? "applies arithmetic to"} the fallback instead of the value. Wrap the nullish expression in parentheses before applying \`${right.operator}\`.`,
      });
    },
  }),
});
