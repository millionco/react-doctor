import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isParameterlessLiteralReturningFunction } from "./is-parameterless-literal-returning-function.js";
import type { RuleContext } from "./rule-context.js";

export interface ClosedSynchronousInertCallbackReplacementInput {
  helperFunction: EsTreeNode;
  writeIdentifier: EsTreeNode;
  callbackCall: EsTreeNode;
  context: RuleContext;
}

export const isClosedSynchronousInertCallbackReplacement = ({
  helperFunction,
  writeIdentifier,
  callbackCall,
  context,
}: ClosedSynchronousInertCallbackReplacementInput): boolean => {
  if (
    !isFunctionLike(helperFunction) ||
    helperFunction.async ||
    helperFunction.generator ||
    helperFunction.params.length === 0 ||
    !isNodeOfType(helperFunction.body, "BlockStatement") ||
    (helperFunction.body.body.length !== 3 && helperFunction.body.body.length !== 4)
  ) {
    return false;
  }
  const [parameter] = helperFunction.params;
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  if (!parameterSymbol || context.scopes.symbolFor(writeIdentifier)?.id !== parameterSymbol.id) {
    return false;
  }
  const parameterNames = new Set([parameter.name]);
  for (let parameterIndex = 1; parameterIndex < helperFunction.params.length; parameterIndex += 1) {
    const extraParameter = helperFunction.params[parameterIndex];
    const extraIdentifier = isNodeOfType(extraParameter, "AssignmentPattern")
      ? extraParameter.left
      : extraParameter;
    if (!isNodeOfType(extraIdentifier, "Identifier") || parameterNames.has(extraIdentifier.name)) {
      return false;
    }
    const extraSymbol = context.scopes.symbolFor(extraIdentifier);
    if (
      !extraSymbol ||
      extraSymbol.kind !== "parameter" ||
      extraSymbol.bindingIdentifier !== extraIdentifier ||
      extraSymbol.declarationNode !== extraParameter ||
      extraSymbol.references.length !== 0
    ) {
      return false;
    }
    if (isNodeOfType(extraParameter, "AssignmentPattern")) {
      const defaultExpression = extraParameter.right;
      const isScalarLiteral =
        isNodeOfType(defaultExpression, "Literal") &&
        !("regex" in defaultExpression) &&
        (defaultExpression.value === null ||
          typeof defaultExpression.value === "boolean" ||
          typeof defaultExpression.value === "number" ||
          typeof defaultExpression.value === "string" ||
          typeof defaultExpression.value === "bigint");
      if (!isScalarLiteral && !isParameterlessLiteralReturningFunction(defaultExpression)) {
        return false;
      }
    }
    parameterNames.add(extraIdentifier.name);
  }
  const statements = helperFunction.body.body;
  const replacementDeclaration = statements.at(-3);
  const invocationStatement = statements.at(-2);
  const returnStatement = statements.at(-1);
  if (
    !isNodeOfType(replacementDeclaration, "VariableDeclaration") ||
    replacementDeclaration.kind !== "const" ||
    replacementDeclaration.declarations.length !== 1 ||
    !isNodeOfType(invocationStatement, "ExpressionStatement") ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    returnStatement.argument !== callbackCall ||
    !isNodeOfType(callbackCall, "CallExpression") ||
    callbackCall.optional ||
    callbackCall.arguments.length !== 0 ||
    !isNodeOfType(callbackCall.callee, "Identifier") ||
    context.scopes.symbolFor(callbackCall.callee)?.id !== parameterSymbol.id
  ) {
    return false;
  }
  const [replacementBinding] = replacementDeclaration.declarations;
  if (!replacementBinding || !isNodeOfType(replacementBinding.id, "Identifier")) return false;
  const replacementSymbol = context.scopes.symbolFor(replacementBinding.id);
  const replacementFunction = replacementBinding.init;
  const invocation = invocationStatement.expression;
  if (
    !replacementSymbol ||
    !isFunctionLike(replacementFunction) ||
    !replacementFunction.async ||
    replacementFunction.generator ||
    replacementFunction.params.length !== 0 ||
    !isNodeOfType(replacementFunction.body, "BlockStatement") ||
    replacementFunction.body.body.length !== 1 ||
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.arguments.length !== 0 ||
    !isNodeOfType(invocation.callee, "Identifier") ||
    context.scopes.symbolFor(invocation.callee)?.id !== replacementSymbol.id
  ) {
    return false;
  }
  const [tryStatement] = replacementFunction.body.body;
  if (
    !isNodeOfType(tryStatement, "TryStatement") ||
    tryStatement.block.body.length !== 1 ||
    Boolean(tryStatement.handler) === Boolean(tryStatement.finalizer) ||
    (tryStatement.handler?.param && !isNodeOfType(tryStatement.handler.param, "Identifier"))
  ) {
    return false;
  }
  const [awaitStatement] = tryStatement.block.body;
  const handlerBody = tryStatement.handler?.body ?? tryStatement.finalizer;
  if (
    !isNodeOfType(awaitStatement, "ExpressionStatement") ||
    !isNodeOfType(awaitStatement.expression, "AwaitExpression") ||
    !handlerBody ||
    handlerBody.body.length !== 1
  ) {
    return false;
  }
  const awaitedCall = awaitStatement.expression.argument;
  if (
    !isNodeOfType(awaitedCall, "CallExpression") ||
    awaitedCall.optional ||
    awaitedCall.arguments.length !== 0
  ) {
    return false;
  }
  let throwingFunction: EsTreeNode | null | undefined = awaitedCall.callee;
  if (statements.length === 4) {
    const [throwingDeclaration] = statements;
    if (
      !isNodeOfType(throwingDeclaration, "VariableDeclaration") ||
      throwingDeclaration.kind !== "const" ||
      throwingDeclaration.declarations.length !== 1 ||
      !isNodeOfType(awaitedCall.callee, "Identifier")
    ) {
      return false;
    }
    const [throwingBinding] = throwingDeclaration.declarations;
    if (!throwingBinding || !isNodeOfType(throwingBinding.id, "Identifier")) return false;
    const throwingSymbol = context.scopes.symbolFor(throwingBinding.id);
    if (!throwingSymbol || context.scopes.symbolFor(awaitedCall.callee)?.id !== throwingSymbol.id) {
      return false;
    }
    throwingFunction = throwingBinding.init;
  }
  if (
    !isFunctionLike(throwingFunction) ||
    throwingFunction.async ||
    throwingFunction.generator ||
    throwingFunction.params.length !== 0 ||
    !isNodeOfType(throwingFunction.body, "BlockStatement") ||
    throwingFunction.body.body.length !== 1
  ) {
    return false;
  }
  const [throwStatement] = throwingFunction.body.body;
  const [assignmentStatement] = handlerBody.body;
  if (
    !isNodeOfType(throwStatement, "ThrowStatement") ||
    !isNodeOfType(throwStatement.argument, "Literal") ||
    !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
    !isNodeOfType(assignmentStatement.expression, "AssignmentExpression") ||
    assignmentStatement.expression.operator !== "=" ||
    assignmentStatement.expression.left !== writeIdentifier
  ) {
    return false;
  }
  const assignedFunction = assignmentStatement.expression.right;
  return (
    isFunctionLike(assignedFunction) &&
    !assignedFunction.async &&
    !assignedFunction.generator &&
    isParameterlessLiteralReturningFunction(assignedFunction)
  );
};
