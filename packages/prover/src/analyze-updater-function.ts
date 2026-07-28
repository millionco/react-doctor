import ts from "typescript";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactObligationStatus } from "./types.js";
import type { ReactAnalysisContext } from "./types.js";
import { isDeferredCallbackSynchronous } from "./utils/is-deferred-callback-synchronous.js";

export const analyzeUpdaterFunction = (
  expression: ts.Expression,
  context: ReactAnalysisContext,
): {
  updaterFunction: ts.FunctionLikeDeclaration | null;
  status: ReactObligationStatus;
} => {
  const updaterFunction = resolveFunction(expression, context.typeChecker);
  if (
    !updaterFunction ||
    updaterFunction.asteriskToken ||
    !isDeferredCallbackSynchronous(updaterFunction, context)
  ) {
    return { updaterFunction, status: ReactObligationStatus.Unknown };
  }
  return {
    updaterFunction,
    status: analyzeRenderPurity(updaterFunction, context).status,
  };
};
