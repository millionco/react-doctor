import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `Math.min` / `Math.max` can only express the scalar extremum of an
// array's own values. `arr.sort(cmp)[0]` is equivalent ONLY when the
// comparator is the default sort (no argument) or the canonical numeric
// identity comparator `(a, b) => a - b` / `(a, b) => b - a`. A comparator
// that orders by a derived key, breaks ties, or returns the element
// object cannot be rewritten as `Math.min/max`, so we must not report it.
const isCanonicalNumericComparator = (comparator: EsTreeNode | undefined): boolean => {
  if (
    !comparator ||
    (!isNodeOfType(comparator, "ArrowFunctionExpression") &&
      !isNodeOfType(comparator, "FunctionExpression"))
  ) {
    return false;
  }
  const parameters = comparator.params ?? [];
  if (parameters.length !== 2) return false;
  const [firstParameter, secondParameter] = parameters;
  if (!isNodeOfType(firstParameter, "Identifier") || !isNodeOfType(secondParameter, "Identifier")) {
    return false;
  }

  let comparisonExpression: EsTreeNode | null = null;
  const body = comparator.body;
  if (isNodeOfType(body, "BinaryExpression")) {
    comparisonExpression = body;
  } else if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    if (statements.length !== 1) return false;
    const onlyStatement = statements[0];
    if (!isNodeOfType(onlyStatement, "ReturnStatement") || !onlyStatement.argument) return false;
    comparisonExpression = onlyStatement.argument as EsTreeNode;
  }

  if (
    !comparisonExpression ||
    !isNodeOfType(comparisonExpression, "BinaryExpression") ||
    comparisonExpression.operator !== "-" ||
    !isNodeOfType(comparisonExpression.left, "Identifier") ||
    !isNodeOfType(comparisonExpression.right, "Identifier")
  ) {
    return false;
  }

  const leftName = comparisonExpression.left.name;
  const rightName = comparisonExpression.right.name;
  return (
    (leftName === firstParameter.name && rightName === secondParameter.name) ||
    (leftName === secondParameter.name && rightName === firstParameter.name)
  );
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
      const sortsByScalarExtremum =
        (object.arguments?.length ?? 0) === 0 || isCanonicalNumericComparator(comparator);
      if (!sortsByScalarExtremum) return;

      const isFirstElement = isNodeOfType(node.property, "Literal") && node.property.value === 0;
      const isLastElement =
        isNodeOfType(node.property, "BinaryExpression") &&
        node.property.operator === "-" &&
        isNodeOfType(node.property.right, "Literal") &&
        node.property.right.value === 1;

      if (isFirstElement || isLastElement) {
        const targetFunction = isFirstElement ? "min" : "max";
        context.report({
          node,
          message: `This is slow because array.sort()[${isFirstElement ? "0" : "length-1"}] sorts the whole list just to grab the smallest or largest, so use Math.${targetFunction}(...array) instead`,
        });
      }
    },
  }),
});
