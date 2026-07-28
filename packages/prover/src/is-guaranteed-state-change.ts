import ts from "typescript";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export interface GuaranteedStateChangeInput {
  callExpression: ts.CallExpression;
  stateSymbol: ts.Symbol;
  typeChecker: ts.TypeChecker;
}

const getReturnedExpression = (
  functionNode: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | null => {
  if (!ts.isBlock(functionNode.body)) return functionNode.body;
  if (
    functionNode.body.statements.length !== 1 ||
    !ts.isReturnStatement(functionNode.body.statements[0]) ||
    !functionNode.body.statements[0].expression
  ) {
    return null;
  }
  return functionNode.body.statements[0].expression;
};

const isFreshReference = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return (
    ts.isArrayLiteralExpression(unwrappedExpression) ||
    ts.isObjectLiteralExpression(unwrappedExpression) ||
    ts.isNewExpression(unwrappedExpression)
  );
};

const isBooleanNegationOfSymbol = (
  expression: ts.Expression,
  expectedSymbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return (
    ts.isPrefixUnaryExpression(unwrappedExpression) &&
    unwrappedExpression.operator === ts.SyntaxKind.ExclamationToken &&
    typeChecker.getSymbolAtLocation(unwrapTypescriptExpression(unwrappedExpression.operand)) ===
      expectedSymbol
  );
};

export const isGuaranteedStateChange = ({
  callExpression,
  stateSymbol,
  typeChecker,
}: GuaranteedStateChangeInput): boolean => {
  const updateExpression = callExpression.arguments[0];
  if (!updateExpression) return false;
  const unwrappedUpdate = unwrapTypescriptExpression(updateExpression);
  if (isFreshReference(unwrappedUpdate)) return true;
  if (isBooleanNegationOfSymbol(unwrappedUpdate, stateSymbol, typeChecker)) return true;
  if (!ts.isArrowFunction(unwrappedUpdate) && !ts.isFunctionExpression(unwrappedUpdate)) {
    return false;
  }
  const parameter = unwrappedUpdate.parameters[0];
  if (!parameter || !ts.isIdentifier(parameter.name)) return false;
  const parameterSymbol = typeChecker.getSymbolAtLocation(parameter.name);
  const returnedExpression = getReturnedExpression(unwrappedUpdate);
  if (!parameterSymbol || !returnedExpression) return false;
  return (
    isFreshReference(returnedExpression) ||
    isBooleanNegationOfSymbol(returnedExpression, parameterSymbol, typeChecker)
  );
};
