import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

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

const getStaticFiniteNumericValue = (expression: EsTreeNode): number | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Literal")) {
    return typeof strippedExpression.value === "number" && Number.isFinite(strippedExpression.value)
      ? strippedExpression.value
      : null;
  }
  if (
    !isNodeOfType(strippedExpression, "UnaryExpression") ||
    (strippedExpression.operator !== "+" && strippedExpression.operator !== "-")
  ) {
    return null;
  }
  const argumentValue = getStaticFiniteNumericValue(strippedExpression.argument);
  if (argumentValue === null) return null;
  const numericValue = strippedExpression.operator === "-" ? -argumentValue : +argumentValue;
  return Number.isFinite(numericValue) ? numericValue : null;
};

const isSafeFreshNumericArray = (arrayExpression: EsTreeNodeOfType<"ArrayExpression">): boolean => {
  if (arrayExpression.elements.length === 0) return false;
  let didFindPositiveZero = false;
  let didFindNegativeZero = false;
  for (const element of arrayExpression.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) return false;
    const numericValue = getStaticFiniteNumericValue(element);
    if (numericValue === null) return false;
    if (Object.is(numericValue, 0)) didFindPositiveZero = true;
    if (Object.is(numericValue, -0)) didFindNegativeZero = true;
  }
  return !(didFindPositiveZero && didFindNegativeZero);
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

      if (!isNodeOfType(object.callee, "MemberExpression")) return;
      const sortReceiver = stripParenExpression(object.callee.object);
      if (!isNodeOfType(sortReceiver, "ArrayExpression") || !isSafeFreshNumericArray(sortReceiver))
        return;

      const comparator = object.arguments?.[0] as EsTreeNode | undefined;
      const direction = numericComparatorDirection(comparator);
      if (!direction) return;

      const isFirstElement = isNodeOfType(node.property, "Literal") && node.property.value === 0;
      if (!isFirstElement) return;
      const targetFunction = direction === "ascending" ? "min" : "max";
      context.report({
        node,
        message: `This is slow because array.sort()[0] sorts the whole list just to grab the smallest or largest, so use Math.${targetFunction}(...array) instead`,
      });
    },
  }),
});
