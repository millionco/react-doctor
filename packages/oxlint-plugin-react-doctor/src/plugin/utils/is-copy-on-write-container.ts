import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { areExpressionsStructurallyEqual } from "./are-expressions-structurally-equal.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "./has-static-property-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isCopyOnWriteContainer = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(identifier);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  if (
    symbol?.kind !== "let" ||
    !isNodeOfType(initializer, "MemberExpression") ||
    !isNodeOfType(initializer.object, "Identifier") ||
    findEnclosingFunction(symbol.bindingIdentifier) !== findEnclosingFunction(identifier)
  )
    return false;
  const propertyName = getStaticPropertyName(initializer);
  if (!propertyName || hasPossibleStaticPropertyWrite(initializer.object, propertyName, scopes))
    return false;
  const sourceSymbol = scopes.symbolFor(initializer.object);
  if (
    !sourceSymbol ||
    sourceSymbol.references.some((reference) => {
      if (reference.flag !== "read") return true;
      const parent = findTransparentExpressionRoot(reference.identifier).parent;
      if (isNodeOfType(parent, "ConditionalExpression")) {
        let result: EsTreeNode = parent;
        while (isNodeOfType(result.parent, "ConditionalExpression")) result = result.parent;
        return !isNodeOfType(result.parent, "ReturnStatement");
      }
      if (isNodeOfType(parent, "MemberExpression")) {
        const consumer = findTransparentExpressionRoot(parent).parent;
        return isNodeOfType(consumer, "CallExpression") && consumer.callee === parent;
      }
      return (
        !isNodeOfType(parent, "MemberExpression") &&
        !isNodeOfType(parent, "ReturnStatement") &&
        !(isNodeOfType(parent, "SpreadElement") && isNodeOfType(parent.parent, "ObjectExpression"))
      );
    })
  )
    return false;
  const writes = symbol.references.filter((reference) => reference.flag !== "read");
  if (writes.length !== 1) return false;
  const assignment = findTransparentExpressionRoot(writes[0].identifier).parent;
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
    return false;
  const copy = stripParenExpression(assignment.right);
  if (!isNodeOfType(copy, "ObjectExpression") || copy.properties.length !== 1) return false;
  const spread = copy.properties[0];
  if (
    !isNodeOfType(spread, "SpreadElement") ||
    scopes.symbolFor(stripParenExpression(spread.argument))?.id !== symbol.id
  )
    return false;
  const statement = assignment.parent;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const branch = isNodeOfType(statement.parent, "BlockStatement") ? statement.parent : statement;
  if (
    isNodeOfType(branch, "BlockStatement") &&
    (branch.body.length !== 1 || branch.body[0] !== statement)
  )
    return false;
  const guard = branch.parent;
  if (!isNodeOfType(guard, "IfStatement") || guard.consequent !== branch || guard.alternate)
    return false;
  const block = guard.parent;
  if (!isNodeOfType(block, "BlockStatement")) return false;
  let mutationStatement = identifier;
  while (mutationStatement.parent && mutationStatement.parent !== block)
    mutationStatement = mutationStatement.parent;
  const guardIndex = block.body.findIndex((statement) => statement === guard);
  if (block.body.findIndex((child) => child === mutationStatement) !== guardIndex + 1) return false;
  const test = stripParenExpression(guard.test);
  if (isNodeOfType(test, "BinaryExpression") && test.operator === "===") {
    const left = stripParenExpression(test.left);
    const right = stripParenExpression(test.right);
    let original: EsTreeNode | null = null;
    if (scopes.symbolFor(left)?.id === symbol.id) original = right;
    else if (scopes.symbolFor(right)?.id === symbol.id) original = left;
    return Boolean(
      original &&
      areExpressionsStructurallyEqual(original, initializer, {
        areIdentifiersEqual: (first, second) =>
          Boolean(
            scopes.symbolFor(first) && scopes.symbolFor(first)?.id === scopes.symbolFor(second)?.id,
          ),
      }),
    );
  }
  if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return false;
  const flag = scopes.symbolFor(stripParenExpression(test.argument));
  if (
    flag?.kind !== "let" ||
    flag.scope !== symbol.scope ||
    symbol.bindingIdentifier.range[0] >= block.range[0] ||
    !isNodeOfType(flag.initializer, "Literal") ||
    flag.initializer.value !== false ||
    findEnclosingFunction(flag.bindingIdentifier) !== findEnclosingFunction(identifier)
  )
    return false;
  const flagWrites = flag.references.filter((reference) => reference.flag !== "read");
  if (flagWrites.length !== 1) return false;
  const flagAssignment = findTransparentExpressionRoot(flagWrites[0].identifier).parent;
  return Boolean(
    isNodeOfType(flagAssignment, "AssignmentExpression") &&
    flagAssignment.operator === "=" &&
    isNodeOfType(flagAssignment.right, "Literal") &&
    flagAssignment.right.value === true &&
    isNodeOfType(flagAssignment.parent, "ExpressionStatement") &&
    flagAssignment.parent.parent === block &&
    block.body.findIndex((statement) => statement === flagAssignment.parent) > guardIndex,
  );
};
