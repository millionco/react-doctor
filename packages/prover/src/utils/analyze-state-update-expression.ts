import ts from "typescript";
import { analyzeUpdaterFunction } from "../analyze-updater-function.js";
import { ReactHookStateUpdaterStatus, ReactObligationStatus } from "../types.js";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";
import { doesTypeHaveCallSignature } from "./does-type-have-call-signature.js";
import type { ReactAnalysisContext } from "../types.js";

export interface StateUpdateExpressionAnalysis {
  updaterFunction: ts.FunctionLikeDeclaration | null;
  updaterStatus: ReactHookStateUpdaterStatus;
}

export const analyzeStateUpdateExpression = (
  updaterExpression: ts.Expression,
  context: ReactAnalysisContext,
): StateUpdateExpressionAnalysis => {
  const unwrappedUpdater = unwrapTypescriptExpression(updaterExpression);
  const updaterAnalysis = analyzeUpdaterFunction(unwrappedUpdater, context);
  if (updaterAnalysis.updaterFunction) {
    let updaterStatus = ReactHookStateUpdaterStatus.Unknown;
    if (updaterAnalysis.status === ReactObligationStatus.Proved) {
      updaterStatus = ReactHookStateUpdaterStatus.Pure;
    } else if (updaterAnalysis.status === ReactObligationStatus.Violated) {
      updaterStatus = ReactHookStateUpdaterStatus.Impure;
    }
    return {
      updaterFunction: updaterAnalysis.updaterFunction,
      updaterStatus,
    };
  }
  const updaterType = context.typeChecker.getTypeAtLocation(unwrappedUpdater);
  if (
    updaterType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) ||
    doesTypeHaveCallSignature(updaterType)
  ) {
    return {
      updaterFunction: null,
      updaterStatus: ReactHookStateUpdaterStatus.Unknown,
    };
  }
  return {
    updaterFunction: null,
    updaterStatus: ReactHookStateUpdaterStatus.DirectValue,
  };
};
