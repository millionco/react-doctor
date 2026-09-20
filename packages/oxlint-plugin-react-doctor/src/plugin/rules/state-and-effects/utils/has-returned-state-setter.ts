import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../../utils/get-effective-object-properties-in-insertion-order.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { MAX_RETURNED_SETTER_EXPRESSIONS } from "./constants.js";

export const hasReturnedStateSetter = (
  context: RuleContext,
  stateDeclarator: EsTreeNode,
): boolean => {
  if (
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern")
  ) {
    return false;
  }
  const [, setterBinding] = stateDeclarator.id.elements;
  if (!isNodeOfType(setterBinding, "Identifier")) return false;
  const setterSymbol = context.scopes.symbolFor(setterBinding);
  if (!setterSymbol || setterSymbol.references.some((reference) => reference.flag !== "read")) {
    return false;
  }
  const owner = findEnclosingFunction(stateDeclarator);
  if (!owner) return false;
  const pendingExpressions: EsTreeNode[] = [];
  for (const statement of collectFunctionReturnStatements(owner)) {
    if (statement.argument && isNodeReachableWithinFunction(statement, context)) {
      pendingExpressions.push(statement.argument);
    }
  }
  const visitedExpressions = new Set<EsTreeNode>();
  while (
    pendingExpressions.length > 0 &&
    visitedExpressions.size < MAX_RETURNED_SETTER_EXPRESSIONS
  ) {
    const pendingExpression = pendingExpressions.pop();
    if (!pendingExpression) break;
    const expression = stripParenExpression(pendingExpression);
    if (visitedExpressions.has(expression)) continue;
    visitedExpressions.add(expression);
    if (isNodeOfType(expression, "Identifier")) {
      const symbol = context.scopes.symbolFor(expression);
      if (symbol === setterSymbol) return true;
      if (
        symbol?.kind !== "const" ||
        !symbol.initializer ||
        !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
        !isNodeOfType(symbol.declarationNode.id, "Identifier") ||
        symbol.references.some((reference) => reference.flag !== "read")
      ) {
        continue;
      }
      const initializer = stripParenExpression(symbol.initializer);
      if (isNodeOfType(initializer, "Identifier")) pendingExpressions.push(initializer);
    } else if (isNodeOfType(expression, "ArrayExpression")) {
      for (const element of expression.elements) {
        if (element && !isNodeOfType(element, "SpreadElement")) pendingExpressions.push(element);
      }
    } else if (isNodeOfType(expression, "ObjectExpression")) {
      if (expression.properties.some((property) => isNodeOfType(property, "SpreadElement")))
        continue;
      const properties = getEffectiveObjectPropertiesInInsertionOrder(expression.properties);
      for (const property of properties ?? []) {
        if (property.kind === "init" && !property.method) pendingExpressions.push(property.value);
      }
    }
  }
  return false;
};
