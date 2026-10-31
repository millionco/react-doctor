import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isDefinitelyFalsyExpression } from "../../../utils/is-definitely-falsy-expression.js";
import { isInlineFunctionExpression } from "../../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface GetAwaitedRequestFulfillmentSetterOptions {
  awaitExpression: EsTreeNode;
  context: RuleContext;
  matchesRequestCall: (node: EsTreeNode) => boolean;
  matchesStateSetterCall: (node: EsTreeNode) => boolean;
}

const isPrimitiveConditionLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") &&
  !("regex" in node) &&
  !("bigint" in node) &&
  (node.value === null || ["string", "number", "boolean"].includes(typeof node.value));

const isSupportedConditionReference = (node: EsTreeNode, context: RuleContext): boolean => {
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    if (current.computed || current.optional || !isNodeOfType(current.property, "Identifier"))
      return false;
    current = stripParenExpression(current.object);
  }
  if (!isNodeOfType(current, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(current);
  if (!symbol) return false;
  if (symbol.kind === "parameter" || symbol.kind === "catch-clause-parameter") return true;
  if (symbol.kind !== "const" && symbol.kind !== "let" && symbol.kind !== "var") return false;
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "VariableDeclarator") || !declaration.init) return false;
  const value = stripParenExpression(declaration.init);
  return isNodeOfType(value, "CallExpression") || isNodeOfType(value, "AwaitExpression");
};

const isSupportedCondition = (node: EsTreeNode, context: RuleContext): boolean => {
  const test = stripParenExpression(node);
  if (isPrimitiveConditionLiteral(test) || isSupportedConditionReference(test, context))
    return true;
  if (isNodeOfType(test, "UnaryExpression") && test.operator === "!")
    return isSupportedConditionReference(test.argument, context);
  return (
    isNodeOfType(test, "BinaryExpression") &&
    (test.operator === "===" || test.operator === "!==") &&
    ((isPrimitiveConditionLiteral(stripParenExpression(test.left)) &&
      isSupportedConditionReference(test.right, context)) ||
      (isPrimitiveConditionLiteral(stripParenExpression(test.right)) &&
        isSupportedConditionReference(test.left, context)))
  );
};

export const getAwaitedRequestFulfillmentSetter = (
  options: GetAwaitedRequestFulfillmentSetterOptions,
): EsTreeNode | null => {
  const { awaitExpression, context } = options;
  if (
    !isNodeOfType(awaitExpression, "AwaitExpression") ||
    !isNodeOfType(awaitExpression.parent, "ExpressionStatement") ||
    awaitExpression.parent.expression !== awaitExpression ||
    !isNodeReachableWithinFunction(awaitExpression, context)
  )
    return null;
  let current: EsTreeNode = awaitExpression;
  while (current.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "ForStatement") ||
      isNodeOfType(parent, "ForInStatement") ||
      isNodeOfType(parent, "ForOfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "SwitchStatement") ||
      isNodeOfType(parent, "SwitchCase") ||
      isNodeOfType(parent, "CatchClause")
    )
      return null;
    if (isNodeOfType(parent, "IfStatement")) {
      const test = stripParenExpression(parent.test);
      if (
        !isSupportedCondition(test, context) ||
        (parent.consequent === current && isDefinitelyFalsyExpression(test, context.scopes)) ||
        (parent.alternate === current && isNodeOfType(test, "Literal") && test.value)
      )
        return null;
    }
    if (
      isNodeOfType(parent, "FunctionDeclaration") ||
      isNodeOfType(parent, "FunctionExpression") ||
      isNodeOfType(parent, "ArrowFunctionExpression")
    )
      break;
    current = parent;
  }
  const thenCall = awaitExpression.argument;
  if (
    !isNodeOfType(thenCall, "CallExpression") ||
    thenCall.optional ||
    !isNodeOfType(thenCall.callee, "MemberExpression") ||
    thenCall.callee.computed ||
    thenCall.callee.optional ||
    !isNodeOfType(thenCall.callee.property, "Identifier") ||
    thenCall.callee.property.name !== "then" ||
    !isNodeOfType(thenCall.callee.object, "CallExpression") ||
    thenCall.callee.object.optional ||
    (isNodeOfType(thenCall.callee.object.callee, "MemberExpression") &&
      (thenCall.callee.object.callee.computed || thenCall.callee.object.callee.optional)) ||
    !options.matchesRequestCall(thenCall.callee.object)
  )
    return null;
  const [callback, ...otherArguments] = thenCall.arguments;
  if (
    !isInlineFunctionExpression(callback) ||
    callback.async ||
    callback.generator ||
    otherArguments.length
  )
    return null;
  const [parameter, ...otherParameters] = callback.params;
  if (otherParameters.length || (parameter && !isNodeOfType(parameter, "Identifier"))) return null;
  let setter = callback.body;
  if (isNodeOfType(setter, "BlockStatement")) {
    const [firstStatement] = setter.body;
    if (!isNodeOfType(firstStatement, "ExpressionStatement")) return null;
    setter = firstStatement.expression;
  }
  return isNodeOfType(setter, "CallExpression") &&
    !setter.optional &&
    options.matchesStateSetterCall(setter)
    ? setter
    : null;
};
