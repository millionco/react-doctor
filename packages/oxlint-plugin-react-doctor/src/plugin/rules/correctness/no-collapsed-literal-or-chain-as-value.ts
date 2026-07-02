import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
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

type LiteralKind = "string" | "number";

// Classifies a chain LEAF: a bare string/number literal or an
// expression-free template literal (a string). Any other operand —
// Identifier, MemberExpression, CallExpression, boolean/null literal —
// returns null so the whole chain is rejected (a real default/fallback
// like `x || "default"` must never match).
const classifyCollapsibleLiteral = (node: EsTreeNode): LiteralKind | null => {
  if (isNodeOfType(node, "Literal")) {
    if (typeof node.value === "string") return "string";
    if (typeof node.value === "number") return "number";
    return null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(node) === null ? null : "string";
  }
  return null;
};

// Walks a `||`/`&&` chain and returns the single literal kind shared by
// every operand, or null when any operand is non-literal, a nested `??`
// chain, or the operands mix string and number types.
const collectSharedLiteralKind = (rawNode: EsTreeNode): LiteralKind | null => {
  const node = stripGroupingParens(rawNode);
  if (isNodeOfType(node, "LogicalExpression")) {
    if (node.operator !== "||" && node.operator !== "&&") return null;
    const leftKind = collectSharedLiteralKind(node.left as EsTreeNode);
    if (!leftKind) return null;
    const rightKind = collectSharedLiteralKind(node.right as EsTreeNode);
    if (!rightKind) return null;
    return leftKind === rightKind ? leftKind : null;
  }
  return classifyCollapsibleLiteral(node);
};

const isConsumedByStringSearchCall = (chainOrWrapper: EsTreeNode, parent: EsTreeNode): boolean => {
  if (!isNodeOfType(parent, "CallExpression")) return false;
  const callee = parent.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    !STRING_SEARCH_METHODS.has(callee.property.name)
  ) {
    return false;
  }
  return parent.arguments.some((argument) => argument === chainOrWrapper);
};

const isReceiverOfStringSearchCall = (chainOrWrapper: EsTreeNode, parent: EsTreeNode): boolean => {
  if (
    !isNodeOfType(parent, "MemberExpression") ||
    parent.object !== chainOrWrapper ||
    parent.computed ||
    !isNodeOfType(parent.property, "Identifier") ||
    !STRING_SEARCH_METHODS.has(parent.property.name)
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
  title: "All-literal logical chain collapses to its first value",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Compare against each value separately (or use an array `.includes(x)`) instead of an all-literal `||`/`&&` chain, which short-circuits to its first literal and drops the rest.",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "||" && node.operator !== "&&") return;
      if (!collectSharedLiteralKind(node)) return;

      // Climb through grouping parentheses to find the consuming node,
      // then confirm this chain is the DIRECT argument / operand there. A
      // grouping paren is identified by `stripGroupingParens` peeling it.
      let wrapper: EsTreeNode = node;
      let parent = node.parent ?? null;
      while (parent && stripGroupingParens(parent) !== parent) {
        wrapper = parent;
        parent = parent.parent ?? null;
      }
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
        message: `\`${node.operator}\` short-circuits to its first literal at runtime, so only the first value is ever used and the rest are dead — compare against each value separately or use an array \`.includes(x)\` check.`,
      });
    },
  }),
});
