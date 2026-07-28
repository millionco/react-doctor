import ts from "typescript";
import { analyzeUpdaterFunction } from "./analyze-updater-function.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";
import { ReactHookStateUpdaterStatus, ReactObligationStatus } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { ReactAnalysisContext } from "./types.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { isReactHookDependencyReference } from "./utils/is-react-hook-dependency-reference.js";

export interface HookStateTransitionDescriptor {
  callExpression: ts.CallExpression | null;
  evidenceNode: ts.Node;
  setterName: string;
  stateName: string;
  updaterFunction: ts.FunctionLikeDeclaration | null;
  updaterStatus: ReactHookStateUpdaterStatus;
}

const doesTypeIncludeCallable = (type: ts.Type): boolean =>
  type.getCallSignatures().length > 0 ||
  (type.isUnionOrIntersection() && type.types.some(doesTypeIncludeCallable));

const getUpdaterStatus = (
  updaterExpression: ts.Expression,
  context: ReactAnalysisContext,
): {
  updaterFunction: ts.FunctionLikeDeclaration | null;
  updaterStatus: ReactHookStateUpdaterStatus;
} => {
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
    doesTypeIncludeCallable(updaterType)
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

export const collectHookStateTransitions = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<HookStateTransitionDescriptor> => {
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stateNamesBySetter = new Map(
    [...hookBindings.stateValueBySetter].map(([setterSymbol, stateSymbol]) => [
      setterSymbol,
      stateSymbol.getName(),
    ]),
  );
  const handledSetterReferences = new Set<ts.Identifier>();
  const transitions: HookStateTransitionDescriptor[] = [];
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const unwrappedCallee = unwrapTypescriptExpression(node.expression);
      const setterSymbol = getResolvedSymbol(unwrappedCallee, context.typeChecker);
      const stateName = setterSymbol ? stateNamesBySetter.get(setterSymbol) : undefined;
      if (setterSymbol && stateName) {
        const updaterExpression = node.arguments[0];
        const updaterAnalysis = updaterExpression
          ? getUpdaterStatus(updaterExpression, context)
          : {
              updaterFunction: null,
              updaterStatus: ReactHookStateUpdaterStatus.Unknown,
            };
        transitions.push({
          callExpression: node,
          evidenceNode: node,
          setterName: setterSymbol.getName(),
          stateName,
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
      const stateName = setterSymbol ? stateNamesBySetter.get(setterSymbol) : undefined;
      if (
        setterSymbol &&
        stateName &&
        !isReactHookDependencyReference(node, context.typeChecker) &&
        !transitions.some(
          (transition) =>
            transition.callExpression && isNodeWithin(node, transition.callExpression.expression),
        )
      ) {
        transitions.push({
          callExpression: null,
          evidenceNode: node,
          setterName: setterSymbol.getName(),
          stateName,
          updaterFunction: null,
          updaterStatus: ReactHookStateUpdaterStatus.SetterEscape,
        });
      }
    }
    node.forEachChild(visitEscapes);
  };
  functionNode.forEachChild(visitEscapes);
  return transitions;
};
