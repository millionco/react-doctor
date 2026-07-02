import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// `Math.min` / `Math.max` can only express the scalar extremum of an
// array's own values. `arr.sort(cmp)[0]` is equivalent ONLY when the
// comparator is the canonical numeric identity comparator: `(a, b) => a - b`
// (ascending) or `(a, b) => b - a` (descending). A comparator-less `.sort()`
// is lexicographic, so `Math.min/max` would return NaN for strings — that
// case is excluded. A comparator that orders by a derived key, breaks
// ties, or returns the element object also cannot be rewritten as
// `Math.min/max`, so we must not report it. The direction matters for the
// rewrite hint: ascending puts the min at `[0]`, descending puts the max
// there.
const numericComparatorDirection = (
  comparator: EsTreeNode | undefined,
): "ascending" | "descending" | null => {
  if (!isInlineFunctionExpression(comparator)) return null;
  const parameters = comparator.params ?? [];
  if (parameters.length !== 2) return null;
  const [firstParameter, secondParameter] = parameters;
  if (!isNodeOfType(firstParameter, "Identifier") || !isNodeOfType(secondParameter, "Identifier")) {
    return null;
  }

  let comparisonExpression: EsTreeNode | null = null;
  const comparatorBody = stripParenExpression(comparator.body);
  if (isNodeOfType(comparatorBody, "BinaryExpression")) {
    comparisonExpression = comparatorBody;
  } else if (isNodeOfType(comparatorBody, "BlockStatement")) {
    const statements = comparatorBody.body ?? [];
    if (statements.length !== 1) return null;
    const onlyStatement = statements[0];
    if (!isNodeOfType(onlyStatement, "ReturnStatement") || !onlyStatement.argument) return null;
    comparisonExpression = stripParenExpression(onlyStatement.argument as EsTreeNode);
  }

  if (
    !comparisonExpression ||
    !isNodeOfType(comparisonExpression, "BinaryExpression") ||
    comparisonExpression.operator !== "-" ||
    !isNodeOfType(comparisonExpression.left, "Identifier") ||
    !isNodeOfType(comparisonExpression.right, "Identifier")
  ) {
    return null;
  }

  const leftName = comparisonExpression.left.name;
  const rightName = comparisonExpression.right.name;
  if (leftName === firstParameter.name && rightName === secondParameter.name) return "ascending";
  if (leftName === secondParameter.name && rightName === firstParameter.name) return "descending";
  return null;
};

export const jsMinMaxLoop = defineRule({
  id: "js-min-max-loop",
  title: "sort() to find min or max",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `Math.min(...array)` or `Math.max(...array)` instead of sorting the whole list just to read the first or last item",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (!node.computed) return;

      const object = node.object;
      if (!isNodeOfType(object, "CallExpression") || !isMemberProperty(object.callee, "sort"))
        return;

      const comparator = object.arguments?.[0] as EsTreeNode | undefined;
      const direction = numericComparatorDirection(comparator);
      if (!direction) return;

      const isFirstElement = isNodeOfType(node.property, "Literal") && node.property.value === 0;
      const isLastElement =
        isNodeOfType(node.property, "BinaryExpression") &&
        node.property.operator === "-" &&
        isNodeOfType(node.property.right, "Literal") &&
        node.property.right.value === 1;

      if (isFirstElement || isLastElement) {
        // Ascending puts the min at [0] and max at [length-1]; descending
        // reverses both, so the rewrite hint has to follow the direction.
        const readsMinimum = direction === "ascending" ? isFirstElement : isLastElement;
        const targetFunction = readsMinimum ? "min" : "max";
        context.report({
          node,
          message: `This is slow because array.sort()[${isFirstElement ? "0" : "length-1"}] sorts the whole list just to grab the smallest or largest, so use Math.${targetFunction}(...array) instead`,
        });
      }
    },
  }),
});
