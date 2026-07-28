import ts from "typescript";
import { getPlatformSchedulerKind } from "../collect-effect-scheduler-protocols.js";
import { collectReachableFunctions } from "../collect-reachable-functions.js";
import { PROMISE_CONTINUATION_METHOD_NAMES } from "../constants.js";
import type { ReactAnalysisContext } from "../types.js";
import { collectReachableCallExpressions } from "./collect-reachable-call-expressions.js";
import { containsAwaitOutsideNestedFunction } from "./contains-await-outside-nested-function.js";

const containsThenableType = (type: ts.Type, typeChecker: ts.TypeChecker): boolean =>
  Boolean(typeChecker.getPropertyOfType(type, "then")) ||
  (type.isUnionOrIntersection() &&
    type.types.some((memberType) => containsThenableType(memberType, typeChecker)));

export const isDeferredCallbackSynchronous = (
  callback: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): boolean =>
  collectReachableFunctions(callback, context.typeChecker).every(
    (reachableFunction) =>
      !(ts.getCombinedModifierFlags(reachableFunction.functionNode) & ts.ModifierFlags.Async) &&
      !containsAwaitOutsideNestedFunction(
        reachableFunction.functionNode,
        reachableFunction.functionNode,
      ),
  ) &&
  !collectReachableCallExpressions(callback, context.typeChecker).some(
    (callExpression) =>
      Boolean(getPlatformSchedulerKind(callExpression, context)) ||
      containsThenableType(
        context.typeChecker.getTypeAtLocation(callExpression),
        context.typeChecker,
      ) ||
      (ts.isPropertyAccessExpression(callExpression.expression) &&
        PROMISE_CONTINUATION_METHOD_NAMES.has(callExpression.expression.name.text)),
  );
