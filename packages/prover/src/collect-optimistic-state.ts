import ts from "typescript";
import { analyzeUpdaterFunction } from "./analyze-updater-function.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";
import {
  ReactHookStateUpdaterStatus,
  ReactObligationStatus,
  ReactOptimisticReducerStatus,
} from "./types.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { analyzeStateUpdateExpression } from "./utils/analyze-state-update-expression.js";
import { isReactHookDependencyReference } from "./utils/is-react-hook-dependency-reference.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { BoundOptimisticHookBinding, OptimisticHookBinding } from "./collect-hook-bindings.js";
import type { ReactAnalysisContext } from "./types.js";
import type { StateUpdateExpressionAnalysis } from "./utils/analyze-state-update-expression.js";

export interface OptimisticStateDescriptor {
  binding: OptimisticHookBinding;
  reducerFunction: ts.FunctionLikeDeclaration | null;
  reducerStatus: ReactOptimisticReducerStatus;
}

export interface OptimisticUpdateDescriptor {
  binding: BoundOptimisticHookBinding;
  callExpression: ts.CallExpression | null;
  evidenceNode: ts.Node;
  updaterFunction: ts.FunctionLikeDeclaration | null;
  updaterStatus: ReactHookStateUpdaterStatus;
}

export interface OptimisticStateCollection {
  states: ReadonlyArray<OptimisticStateDescriptor>;
  updates: ReadonlyArray<OptimisticUpdateDescriptor>;
}

const analyzeReducer = (
  binding: OptimisticHookBinding,
  context: ReactAnalysisContext,
): {
  reducerFunction: ts.FunctionLikeDeclaration | null;
  reducerStatus: ReactOptimisticReducerStatus;
} => {
  if (!binding.reducerExpression) {
    return {
      reducerFunction: null,
      reducerStatus: ReactOptimisticReducerStatus.Absent,
    };
  }
  const reducerAnalysis = analyzeUpdaterFunction(binding.reducerExpression, context);
  if (!reducerAnalysis.updaterFunction) {
    return {
      reducerFunction: null,
      reducerStatus: ReactOptimisticReducerStatus.Unknown,
    };
  }
  let reducerStatus = ReactOptimisticReducerStatus.Unknown;
  if (reducerAnalysis.status === ReactObligationStatus.Proved) {
    reducerStatus = ReactOptimisticReducerStatus.Pure;
  } else if (reducerAnalysis.status === ReactObligationStatus.Violated) {
    reducerStatus = ReactOptimisticReducerStatus.Impure;
  }
  return {
    reducerFunction: reducerAnalysis.updaterFunction,
    reducerStatus,
  };
};

export const collectOptimisticState = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): OptimisticStateCollection => {
  const bindings = collectHookBindings(functionNode, context.typeChecker).optimisticBindings;
  const boundBindings = bindings.filter((binding): binding is BoundOptimisticHookBinding =>
    Boolean(binding.setterSymbol),
  );
  const bindingsBySetter = new Map(
    boundBindings.map((binding): [ts.Symbol, BoundOptimisticHookBinding] => [
      binding.setterSymbol,
      binding,
    ]),
  );
  const states = bindings.map(
    (binding): OptimisticStateDescriptor => ({
      binding,
      ...analyzeReducer(binding, context),
    }),
  );
  const handledSetterReferences = new Set<ts.Identifier>();
  const updates: OptimisticUpdateDescriptor[] = [];
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const setterSymbol = getResolvedSymbol(
        unwrapTypescriptExpression(node.expression),
        context.typeChecker,
      );
      const binding = setterSymbol ? bindingsBySetter.get(setterSymbol) : undefined;
      if (binding) {
        const updateExpression = node.arguments[0];
        let updaterAnalysis: StateUpdateExpressionAnalysis = {
          updaterFunction: null,
          updaterStatus: ReactHookStateUpdaterStatus.Unknown,
        };
        if (updateExpression && binding.reducerExpression) {
          updaterAnalysis = {
            updaterFunction: null,
            updaterStatus: ReactHookStateUpdaterStatus.DirectValue,
          };
        } else if (updateExpression) {
          updaterAnalysis = analyzeStateUpdateExpression(updateExpression, context);
        }
        updates.push({
          binding,
          callExpression: node,
          evidenceNode: node,
          ...updaterAnalysis,
        });
        const collectHandledReferences = (calleeNode: ts.Node): void => {
          if (
            ts.isIdentifier(calleeNode) &&
            getResolvedSymbol(calleeNode, context.typeChecker) === setterSymbol
          ) {
            handledSetterReferences.add(calleeNode);
          }
          calleeNode.forEachChild(collectHandledReferences);
        };
        collectHandledReferences(node.expression);
      }
    }
    node.forEachChild(visitCalls);
  };
  functionNode.forEachChild(visitCalls);

  const visitEscapes = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isIdentifierReference(node) &&
      !handledSetterReferences.has(node)
    ) {
      const setterSymbol = getResolvedSymbol(node, context.typeChecker);
      const binding = setterSymbol ? bindingsBySetter.get(setterSymbol) : undefined;
      if (
        binding &&
        !isReactHookDependencyReference(node, context.typeChecker) &&
        !updates.some(
          (update) => update.callExpression && isNodeWithin(node, update.callExpression.expression),
        )
      ) {
        updates.push({
          binding,
          callExpression: null,
          evidenceNode: node,
          updaterFunction: null,
          updaterStatus: ReactHookStateUpdaterStatus.SetterEscape,
        });
      }
    }
    node.forEachChild(visitEscapes);
  };
  functionNode.forEachChild(visitEscapes);
  return { states, updates };
};
