import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface ForwardedRefWrite {
  readonly callback: EsTreeNodeOfType<"CallExpression">;
  readonly callbackValue: EsTreeNode;
  readonly objectValue: EsTreeNode;
}

export interface BalancedForwardedRefEffect {
  readonly callback: EsTreeNodeOfType<"CallExpression">;
  readonly handleValue: EsTreeNode;
}

const isBinding = (
  expression: EsTreeNode,
  ref: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const node = stripParenExpression(expression);
  return isNodeOfType(node, "Identifier") && scopes.symbolFor(node)?.id === ref.id;
};

const unwrapSingleStatement = (statement: EsTreeNode | null): EsTreeNode | null =>
  isNodeOfType(statement, "BlockStatement")
    ? statement.body.length === 1
      ? statement.body[0]
      : null
    : statement;

const isFunctionTypeGuard = (
  test: EsTreeNode,
  ref: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(test);
  if (!isNodeOfType(expression, "BinaryExpression") || expression.operator !== "===") {
    return false;
  }
  const left = stripParenExpression(expression.left);
  const right = stripParenExpression(expression.right);
  return (
    isNodeOfType(left, "UnaryExpression") &&
    left.operator === "typeof" &&
    isBinding(left.argument, ref, scopes) &&
    isNodeOfType(right, "Literal") &&
    right.value === "function"
  );
};

const readRefWrite = (
  statement: EsTreeNode,
  ref: SymbolDescriptor,
  scopes: ScopeAnalysis,
): ForwardedRefWrite | null => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    !isFunctionTypeGuard(statement.test, ref, scopes)
  ) {
    return null;
  }
  const callbackStatement = unwrapSingleStatement(statement.consequent);
  if (!isNodeOfType(callbackStatement, "ExpressionStatement")) return null;
  const callback = stripParenExpression(callbackStatement.expression);
  if (
    !isNodeOfType(callback, "CallExpression") ||
    callback.optional ||
    !isBinding(callback.callee, ref, scopes) ||
    callback.arguments.length !== 1 ||
    isNodeOfType(callback.arguments[0], "SpreadElement")
  ) {
    return null;
  }
  const objectBranch = unwrapSingleStatement(statement.alternate);
  if (
    !isNodeOfType(objectBranch, "IfStatement") ||
    objectBranch.alternate ||
    !isBinding(objectBranch.test, ref, scopes)
  ) {
    return null;
  }
  const objectStatement = unwrapSingleStatement(objectBranch.consequent);
  if (!isNodeOfType(objectStatement, "ExpressionStatement")) return null;
  const assignment = stripParenExpression(objectStatement.expression);
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    getStaticPropertyName(assignment.left) !== "current" ||
    !isBinding(assignment.left.object, ref, scopes)
  ) {
    return null;
  }
  return {
    callback,
    callbackValue: stripParenExpression(callback.arguments[0]),
    objectValue: stripParenExpression(assignment.right),
  };
};

const getCurrentReceiver = (value: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    !isNodeOfType(value, "MemberExpression") ||
    value.optional ||
    getStaticPropertyName(value) !== "current"
  ) {
    return null;
  }
  const receiver = stripParenExpression(value.object);
  return isNodeOfType(receiver, "Identifier") ? receiver : null;
};

const isNullValue = (value: EsTreeNode): boolean =>
  isNodeOfType(value, "Literal") && value.value === null;

export const readBalancedForwardedRefEffect = (
  call: EsTreeNodeOfType<"CallExpression">,
  effect: EsTreeNode,
  scopes: ScopeAnalysis,
): BalancedForwardedRefEffect | null => {
  const dependencies = call.arguments[1];
  if (
    call.arguments.length !== 2 ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 0 ||
    stripParenExpression(call.arguments[0]) !== effect ||
    !isFunctionLike(effect) ||
    effect.async ||
    effect.generator ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    effect.body.body.length !== 2
  ) {
    return null;
  }
  const component = findEnclosingFunction(call);
  if (!component || !isFunctionLike(component)) return null;
  const wrapper = component.parent;
  const refParameter = component.params[1];
  if (
    !isNodeOfType(wrapper, "CallExpression") ||
    wrapper.arguments[0] !== component ||
    wrapper.arguments.length !== 1 ||
    !isNodeOfType(refParameter, "Identifier") ||
    !isReactApiCall(wrapper, "forwardRef", scopes, { resolveNamedAliases: true })
  ) {
    return null;
  }
  const ref = scopes.symbolFor(refParameter);
  if (!ref || ref.references.some((reference) => reference.flag !== "read")) {
    return null;
  }
  const [attachStatement, cleanupReturn] = effect.body.body;
  const attach = readRefWrite(attachStatement, ref, scopes);
  if (!attach || !isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) {
    return null;
  }
  const cleanupFunction = stripParenExpression(cleanupReturn.argument);
  if (
    !isFunctionLike(cleanupFunction) ||
    cleanupFunction.async ||
    cleanupFunction.generator ||
    cleanupFunction.params.length !== 0 ||
    !isNodeOfType(cleanupFunction.body, "BlockStatement") ||
    cleanupFunction.body.body.length !== 1
  ) {
    return null;
  }
  const cleanup = readRefWrite(cleanupFunction.body.body[0], ref, scopes);
  if (!cleanup || !isNullValue(cleanup.callbackValue) || !isNullValue(cleanup.objectValue)) {
    return null;
  }
  const handleReceiver = getCurrentReceiver(attach.callbackValue);
  const objectReceiver = getCurrentReceiver(attach.objectValue);
  if (!handleReceiver || !objectReceiver) return null;
  const handleSymbol = scopes.symbolFor(handleReceiver);
  if (
    !handleSymbol ||
    handleSymbol.id === ref.id ||
    scopes.symbolFor(objectReceiver)?.id !== handleSymbol.id
  ) {
    return null;
  }
  return { callback: attach.callback, handleValue: attach.callbackValue };
};
