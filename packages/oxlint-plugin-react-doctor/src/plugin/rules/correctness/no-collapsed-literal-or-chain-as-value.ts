import { defineRule } from "../../utils/define-rule.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

// String-search methods whose single argument, when written as an
// all-literal `||`/`&&` chain, silently checks only the first literal.
const STRING_SEARCH_METHODS = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "search",
  "match",
  "test",
]);

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

type LiteralKind = "string" | "number" | "regexp";

// Classifies a chain LEAF: a bare string/number literal or an
// expression-free template literal (a string). Any other operand —
// Identifier, MemberExpression, CallExpression, boolean/null literal —
// returns null so the whole chain is rejected (a real default/fallback
// like `x || "default"` must never match).
const classifyCollapsibleLiteral = (node: EsTreeNode): LiteralKind | null => {
  if (isNodeOfType(node, "Literal")) {
    if ("regex" in node && node.regex) return "regexp";
    if (typeof node.value === "string") return "string";
    if (typeof node.value === "number") return "number";
    return null;
  }
  if (
    isNodeOfType(node, "UnaryExpression") &&
    (node.operator === "+" || node.operator === "-") &&
    isNodeOfType(node.argument, "Literal") &&
    typeof node.argument.value === "number"
  ) {
    return "number";
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(node) === null ? null : "string";
  }
  return null;
};

const collectSharedLiteralKind = (rawNode: EsTreeNode): LiteralKind | null => {
  const pendingOperands: EsTreeNode[] = [rawNode];
  let sharedKind: LiteralKind | null = null;
  while (pendingOperands.length > 0) {
    const operand = stripParenExpression(pendingOperands.pop()!);
    if (isNodeOfType(operand, "LogicalExpression")) {
      if (operand.operator !== "||" && operand.operator !== "&&") return null;
      pendingOperands.push(operand.left as EsTreeNode, operand.right as EsTreeNode);
      continue;
    }
    const operandKind = classifyCollapsibleLiteral(operand);
    if (!operandKind) return null;
    if (sharedKind && sharedKind !== operandKind) return null;
    sharedKind = operandKind;
  }
  return sharedKind;
};

const isNestedInLogicalChain = (node: EsTreeNode): boolean => {
  const wrapper = findTransparentExpressionRoot(node);
  const parent = wrapper.parent ?? null;
  return (
    isNodeOfType(parent, "LogicalExpression") &&
    (parent.operator === "||" || parent.operator === "&&")
  );
};

const isConsumedByStringSearchCall = (chainOrWrapper: EsTreeNode, parent: EsTreeNode): boolean => {
  if (!isNodeOfType(parent, "CallExpression")) return false;
  const callee = parent.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !STRING_SEARCH_METHODS.has(getStaticPropertyName(callee) ?? "")
  ) {
    return false;
  }
  return parent.arguments.some((argument) => argument === chainOrWrapper);
};

const isReceiverOfStringSearchCall = (chainOrWrapper: EsTreeNode, parent: EsTreeNode): boolean => {
  if (
    !isNodeOfType(parent, "MemberExpression") ||
    parent.object !== chainOrWrapper ||
    !STRING_SEARCH_METHODS.has(getStaticPropertyName(parent) ?? "")
  ) {
    return false;
  }
  const grandparent = parent.parent ?? null;
  return (
    grandparent !== null &&
    isNodeOfType(grandparent, "CallExpression") &&
    grandparent.callee === parent
  );
};

const isConsumedByEqualityComparison = (chainOrWrapper: EsTreeNode, parent: EsTreeNode): boolean =>
  isNodeOfType(parent, "BinaryExpression") &&
  EQUALITY_OPERATORS.has(parent.operator) &&
  (parent.left === chainOrWrapper || parent.right === chainOrWrapper);

const isConsumedAsSwitchCaseTest = (chainOrWrapper: EsTreeNode, parent: EsTreeNode): boolean =>
  isNodeOfType(parent, "SwitchCase") && parent.test === chainOrWrapper;

export const noCollapsedLiteralOrChainAsValue = defineRule({
  id: "no-collapsed-literal-or-chain-as-value",
  title: "All-literal logical chain used as a multi-value expression",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Compare against each value separately (or use an array `.includes(x)`) instead of an all-literal `||`/`&&` chain, which short-circuits to its first literal and drops the rest.",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "||" && node.operator !== "&&") return;
      if (isNestedInLogicalChain(node)) return;
      if (!collectSharedLiteralKind(node)) return;

      // Climb through grouping parentheses to find the consuming node,
      // then confirm this chain is the DIRECT argument / operand there. A
      // grouping paren is identified by `stripGroupingParens` peeling it.
      const wrapper = findTransparentExpressionRoot(node);
      const parent = wrapper.parent ?? null;
      if (!parent) return;

      if (
        !isConsumedByStringSearchCall(wrapper, parent) &&
        !isReceiverOfStringSearchCall(wrapper, parent) &&
        !isConsumedByEqualityComparison(wrapper, parent) &&
        !isConsumedAsSwitchCaseTest(wrapper, parent)
      ) {
        return;
      }

      context.report({
        node,
        message: `This all-literal \`${node.operator}\` chain evaluates to one fixed literal based on operand truthiness; it does not test multiple candidate values. Compare against each value separately or use an array \`.includes(x)\` check.`,
      });
    },
  }),
});
