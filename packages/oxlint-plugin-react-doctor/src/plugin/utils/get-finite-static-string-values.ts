import { STATIC_STRING_VALUE_LIMIT } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const collectFiniteStaticStringValues = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  values: Set<string>,
  visitedExpressions: Set<EsTreeNode>,
): void => {
  if (!expression || values.size >= STATIC_STRING_VALUE_LIMIT) return;
  const unwrappedExpression = stripParenExpression(expression);
  if (visitedExpressions.has(unwrappedExpression)) return;
  visitedExpressions.add(unwrappedExpression);

  const staticValue = getStaticStringExpression(unwrappedExpression);
  if (staticValue !== null) {
    values.add(staticValue);
    visitedExpressions.delete(unwrappedExpression);
    return;
  }

  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
    collectFiniteStaticStringValues(initializer, context, values, visitedExpressions);
  } else if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    collectFiniteStaticStringValues(
      unwrappedExpression.consequent,
      context,
      values,
      visitedExpressions,
    );
    collectFiniteStaticStringValues(
      unwrappedExpression.alternate,
      context,
      values,
      visitedExpressions,
    );
  } else if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    collectFiniteStaticStringValues(unwrappedExpression.left, context, values, visitedExpressions);
    collectFiniteStaticStringValues(unwrappedExpression.right, context, values, visitedExpressions);
  } else if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
    collectFiniteStaticStringValues(
      unwrappedExpression.expressions.at(-1),
      context,
      values,
      visitedExpressions,
    );
  } else if (
    isNodeOfType(unwrappedExpression, "AssignmentExpression") &&
    unwrappedExpression.operator === "="
  ) {
    collectFiniteStaticStringValues(unwrappedExpression.right, context, values, visitedExpressions);
  } else if (
    isNodeOfType(unwrappedExpression, "BinaryExpression") &&
    unwrappedExpression.operator === "+"
  ) {
    const leftValues = new Set<string>();
    const rightValues = new Set<string>();
    collectFiniteStaticStringValues(
      unwrappedExpression.left,
      context,
      leftValues,
      new Set(visitedExpressions),
    );
    collectFiniteStaticStringValues(
      unwrappedExpression.right,
      context,
      rightValues,
      new Set(visitedExpressions),
    );
    for (const leftValue of leftValues) {
      for (const rightValue of rightValues) {
        values.add(`${leftValue}${rightValue}`);
        if (values.size >= STATIC_STRING_VALUE_LIMIT) break;
      }
      if (values.size >= STATIC_STRING_VALUE_LIMIT) break;
    }
  }

  visitedExpressions.delete(unwrappedExpression);
};

export const getFiniteStaticStringValues = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): ReadonlySet<string> => {
  const values = new Set<string>();
  collectFiniteStaticStringValues(expression, context, values, new Set());
  return values;
};
