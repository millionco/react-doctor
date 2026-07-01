import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const NUMERIC_MEMBER_PROPERTY_NAMES = new Set(["length", "size"]);
const ARITHMETIC_BINARY_OPERATORS = new Set(["-", "+", "*", "/", "%"]);
const NUMERIC_COERCION_CALLEE_NAMES = new Set(["Number", "parseInt", "parseFloat"]);

const isJsxNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment");

// True only for expressions whose runtime value is syntactically numeric, so
// short-circuiting to a falsy `0`/`NaN` leaks a visible text node. No type
// inference — comparisons, `!`/`!!`, `Boolean(...)`, strings, and bare
// identifiers are deliberately excluded because their falsy values render
// nothing.
const isSyntacticallyNumeric = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);

  if (
    isNodeOfType(stripped, "MemberExpression") &&
    !stripped.computed &&
    isNodeOfType(stripped.property, "Identifier") &&
    NUMERIC_MEMBER_PROPERTY_NAMES.has(stripped.property.name)
  ) {
    return true;
  }

  if (
    isNodeOfType(stripped, "BinaryExpression") &&
    ARITHMETIC_BINARY_OPERATORS.has(stripped.operator)
  ) {
    return true;
  }

  if (
    isNodeOfType(stripped, "CallExpression") &&
    isNodeOfType(stripped.callee, "Identifier") &&
    NUMERIC_COERCION_CALLEE_NAMES.has(stripped.callee.name)
  ) {
    return true;
  }

  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "number") return true;

  return false;
};

export const jsxNumericAndLeakedRender = defineRule({
  id: "jsx-numeric-and-leaked-render",
  title: "Numeric && renders a stray 0",
  severity: "warn",
  recommendation:
    "In `{items.length && <List/>}` React renders a literal `0` when the count is 0. Compare explicitly (`items.length > 0 && <List/>`) or use a ternary (`items.length ? <List/> : null`).",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "&&") return;

      // Only handle the outermost `&&` of a chain; inner ones are folded in
      // via `flattenLogicalAndChain` below.
      const parent = node.parent;
      if (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&") return;

      // Must render as a JSX child (`{expr && <X/>}`), not as an attribute
      // value — an attribute never renders a stray text node.
      if (!isNodeOfType(parent, "JSXExpressionContainer")) return;
      const containerParent = parent.parent;
      if (
        !containerParent ||
        !(
          isNodeOfType(containerParent, "JSXElement") ||
          isNodeOfType(containerParent, "JSXFragment")
        )
      ) {
        return;
      }

      const operands = flattenLogicalAndChain(node);
      const lastOperand = operands[operands.length - 1];
      if (!lastOperand || !isJsxNode(stripParenExpression(lastOperand))) return;

      const jsxAdjacentOperand = operands[operands.length - 2];
      if (!jsxAdjacentOperand || !isSyntacticallyNumeric(jsxAdjacentOperand)) return;

      context.report({
        node: jsxAdjacentOperand,
        message:
          "React renders a literal `0` into your page when this count is 0 instead of nothing — compare it explicitly (`count > 0 && <X/>`) or use a ternary (`count ? <X/> : null`).",
      });
    },
  }),
});
