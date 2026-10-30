import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export const isEffectLocalCancellationGuard = (
  expression: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  const identifier =
    isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!"
      ? stripParenExpression(candidate.argument)
      : candidate;
  if (
    !isNodeOfType(identifier, "Identifier") ||
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length !== 0
  )
    return false;
  const symbol = context.scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  if (
    !symbol ||
    (symbol.kind !== "let" && symbol.kind !== "var") ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    declaration.id !== symbol.bindingIdentifier ||
    !declaration.init ||
    findEnclosingFunction(declaration) !== effectCallback ||
    !isNodeOfType(effectCallback.body, "BlockStatement")
  )
    return false;
  const initialValue = stripParenExpression(declaration.init);
  if (!isNodeOfType(initialValue, "Literal") || typeof initialValue.value !== "boolean")
    return false;
  const cleanupReturn = effectCallback.body.body.at(-1);
  if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
  const cleanup = stripParenExpression(cleanupReturn.argument);
  if (!isFunctionLike(cleanup) || cleanup.async || cleanup.generator || cleanup.params.length !== 0)
    return false;
  let cleanupStatement: EsTreeNode = cleanup.body;
  if (isNodeOfType(cleanupStatement, "BlockStatement")) {
    const [statement] = cleanupStatement.body;
    if (cleanupStatement.body.length !== 1 || !isNodeOfType(statement, "ExpressionStatement"))
      return false;
    cleanupStatement = statement.expression;
  }
  const assignment = stripParenExpression(cleanupStatement);
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
    return false;
  const target = stripParenExpression(assignment.left);
  const cleanupValue = stripParenExpression(assignment.right);
  if (
    !isNodeOfType(target, "Identifier") ||
    context.scopes.symbolFor(target) !== symbol ||
    !isNodeOfType(cleanupValue, "Literal") ||
    typeof cleanupValue.value !== "boolean" ||
    cleanupValue.value === initialValue.value
  )
    return false;
  let isClosed = true;
  walkAst(effectCallback, (child) => {
    if (!isClosed) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const callee = stripParenExpression(child.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") isClosed = false;
    }
    if (
      isNodeOfType(child, "Identifier") &&
      context.scopes.symbolFor(child) === symbol &&
      child !== target &&
      isWithinAssignmentTarget(child)
    )
      isClosed = false;
    return undefined;
  });
  return isClosed;
};
