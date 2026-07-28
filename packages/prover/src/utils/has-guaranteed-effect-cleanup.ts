import ts from "typescript";
import { resolveFunction } from "../resolve-function.js";
import { summarizeFunctionReturns } from "../summarize-function-returns.js";

export const hasGuaranteedEffectCleanup = (
  effectCallback: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => {
  const returnSummary = summarizeFunctionReturns(effectCallback, typeChecker);
  return (
    returnSummary.isComplete &&
    !returnSummary.canFallThrough &&
    returnSummary.expressions.length > 0 &&
    returnSummary.expressions.every((returnExpression) =>
      Boolean(resolveFunction(returnExpression.expression, typeChecker)),
    )
  );
};
