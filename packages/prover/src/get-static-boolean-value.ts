import ts from "typescript";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export const getStaticBooleanValue = (expression: ts.Expression): boolean | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(unwrappedExpression) &&
    unwrappedExpression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const argumentValue = getStaticBooleanValue(unwrappedExpression.operand);
    return argumentValue === null ? null : !argumentValue;
  }
  return null;
};
