import ts from "typescript";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isNodeWithin } from "./is-node-within.js";
import { resolveFunction } from "./resolve-function.js";
import {
  ReactClassComponentBase,
  ReactClassStateUpdaterStatus,
  ReactClassUpdateCycleStatus,
  ReactExecutionPhase,
  ReactObligationStatus,
} from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { ReactAnalysisContext } from "./types.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { getStaticAccessMemberName } from "./utils/get-static-access-member-name.js";
import { isEntryDominatingNode } from "./utils/is-entry-dominating-node.js";
import { isDeferredCallbackSynchronous } from "./utils/is-deferred-callback-synchronous.js";
import { isReactSetStateCall } from "./utils/is-react-set-state-call.js";

export interface ClassStateTransitionDescriptor {
  callExpression: ts.CallExpression;
  commitCallbackProvided: boolean;
  cycleStatus: ReactClassUpdateCycleStatus;
  guardNodes: ReadonlyArray<ts.Expression>;
  isSourceComplete: boolean;
  phase: ReactExecutionPhase.ClassMount | ReactExecutionPhase.ClassUpdate;
  updaterFunction: ts.FunctionLikeDeclaration | null;
  updaterStatus: ReactClassStateUpdaterStatus;
}

interface ClassStateSourcePath {
  members: ReadonlyArray<string>;
  source: "current-props" | "previous-props";
}

const getStateSourcePath = (
  expression: ts.Expression,
  previousPropsSymbol: ts.Symbol,
  context: ReactAnalysisContext,
): ClassStateSourcePath | null => {
  let currentExpression = unwrapTypescriptExpression(expression);
  const members: string[] = [];
  while (
    ts.isPropertyAccessExpression(currentExpression) ||
    ts.isElementAccessExpression(currentExpression)
  ) {
    const memberName = getStaticAccessMemberName(currentExpression);
    if (!memberName) return null;
    members.unshift(memberName);
    currentExpression = unwrapTypescriptExpression(currentExpression.expression);
  }
  if (currentExpression.kind === ts.SyntaxKind.ThisKeyword) {
    const [domain, ...pathMembers] = members;
    return domain === "props" ? { members: pathMembers, source: "current-props" } : null;
  }
  if (
    ts.isIdentifier(currentExpression) &&
    getResolvedSymbol(currentExpression, context.typeChecker) === previousPropsSymbol
  ) {
    return { members, source: "previous-props" };
  }
  return null;
};

const areMatchingPropPaths = (
  leftPath: ClassStateSourcePath,
  rightPath: ClassStateSourcePath,
): boolean =>
  leftPath.source !== rightPath.source &&
  leftPath.members.length === 1 &&
  leftPath.members.length === rightPath.members.length &&
  leftPath.members.every((member, memberIndex) => member === rightPath.members[memberIndex]);

const isReflexivePropType = (type: ts.Type): boolean => {
  if (type.isUnionOrIntersection()) {
    return type.types.length > 0 && type.types.every(isReflexivePropType);
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) return true;
  if (
    type.flags &
    (ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.TypeParameter |
      ts.TypeFlags.Never)
  ) {
    return false;
  }
  return Boolean(
    type.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.Object |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined),
  );
};

const isPropTransitionGuard = (
  expression: ts.Expression,
  previousPropsSymbol: ts.Symbol,
  context: ReactAnalysisContext,
): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isBinaryExpression(unwrappedExpression)) {
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return (
        isPropTransitionGuard(unwrappedExpression.left, previousPropsSymbol, context) ||
        isPropTransitionGuard(unwrappedExpression.right, previousPropsSymbol, context)
      );
    }
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return (
        isPropTransitionGuard(unwrappedExpression.left, previousPropsSymbol, context) &&
        isPropTransitionGuard(unwrappedExpression.right, previousPropsSymbol, context)
      );
    }
    if (
      unwrappedExpression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken &&
      unwrappedExpression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      return false;
    }
    const leftPath = getStateSourcePath(unwrappedExpression.left, previousPropsSymbol, context);
    const rightPath = getStateSourcePath(unwrappedExpression.right, previousPropsSymbol, context);
    return Boolean(
      leftPath &&
      rightPath &&
      areMatchingPropPaths(leftPath, rightPath) &&
      isReflexivePropType(context.typeChecker.getTypeAtLocation(unwrappedExpression.left)) &&
      isReflexivePropType(context.typeChecker.getTypeAtLocation(unwrappedExpression.right)),
    );
  }
  return false;
};

const collectPropTransitionGuards = (
  callExpression: ts.CallExpression,
  lifecycleMethod: ts.MethodDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<ts.Expression> => {
  const previousPropsParameter = lifecycleMethod.parameters[0];
  if (!previousPropsParameter || !ts.isIdentifier(previousPropsParameter.name)) return [];
  const previousPropsSymbol = getResolvedSymbol(previousPropsParameter.name, context.typeChecker);
  if (!previousPropsSymbol) return [];
  const guardNodes: ts.Expression[] = [];
  let currentNode: ts.Node | undefined = callExpression.parent;
  while (currentNode && currentNode !== lifecycleMethod) {
    if (
      ts.isIfStatement(currentNode) &&
      isNodeWithin(callExpression, currentNode.thenStatement) &&
      isPropTransitionGuard(currentNode.expression, previousPropsSymbol, context)
    ) {
      guardNodes.push(currentNode.expression);
    }
    currentNode = currentNode.parent;
  }
  return guardNodes;
};

const analyzeUpdater = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): {
  updaterFunction: ts.FunctionLikeDeclaration | null;
  updaterStatus: ReactClassStateUpdaterStatus;
} => {
  const updaterExpression = callExpression.arguments[0];
  if (!updaterExpression) {
    return {
      updaterFunction: null,
      updaterStatus: ReactClassStateUpdaterStatus.Unknown,
    };
  }
  const unwrappedUpdater = unwrapTypescriptExpression(updaterExpression);
  if (unwrappedUpdater.kind === ts.SyntaxKind.NullKeyword) {
    return {
      updaterFunction: null,
      updaterStatus: ReactClassStateUpdaterStatus.Noop,
    };
  }
  if (ts.isObjectLiteralExpression(unwrappedUpdater)) {
    return {
      updaterFunction: null,
      updaterStatus: ReactClassStateUpdaterStatus.Object,
    };
  }
  const updaterFunction = resolveFunction(unwrappedUpdater, context.typeChecker);
  if (!updaterFunction) {
    return {
      updaterFunction: null,
      updaterStatus: ReactClassStateUpdaterStatus.Unknown,
    };
  }
  if (updaterFunction.asteriskToken || !isDeferredCallbackSynchronous(updaterFunction, context)) {
    return {
      updaterFunction,
      updaterStatus: ReactClassStateUpdaterStatus.Unknown,
    };
  }
  const purityProof = analyzeRenderPurity(updaterFunction, context);
  let updaterStatus = ReactClassStateUpdaterStatus.Unknown;
  if (purityProof.status === ReactObligationStatus.Proved) {
    updaterStatus = ReactClassStateUpdaterStatus.Pure;
  } else if (purityProof.status === ReactObligationStatus.Violated) {
    updaterStatus = ReactClassStateUpdaterStatus.Impure;
  }
  return {
    updaterFunction,
    updaterStatus,
  };
};

const collectMethodTransitions = (
  lifecycleMethod: ts.MethodDeclaration | null,
  phase: ReactExecutionPhase.ClassMount | ReactExecutionPhase.ClassUpdate,
  classComponentBase: ReactClassComponentBase,
  context: ReactAnalysisContext,
): ReadonlyArray<ClassStateTransitionDescriptor> => {
  if (!lifecycleMethod) return [];
  const transitions: ClassStateTransitionDescriptor[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== lifecycleMethod && isFunctionBoundary(node)) return;
    if (ts.isCallExpression(node) && isReactSetStateCall(node, context)) {
      const updater = analyzeUpdater(node, context);
      const guardNodes =
        phase === ReactExecutionPhase.ClassUpdate
          ? collectPropTransitionGuards(node, lifecycleMethod, context)
          : [];
      let cycleStatus = ReactClassUpdateCycleStatus.None;
      if (phase === ReactExecutionPhase.ClassUpdate) {
        if (updater.updaterStatus === ReactClassStateUpdaterStatus.Noop) {
          cycleStatus = ReactClassUpdateCycleStatus.None;
        } else if (guardNodes.length > 0) {
          cycleStatus = ReactClassUpdateCycleStatus.Bounded;
        } else if (
          updater.updaterStatus === ReactClassStateUpdaterStatus.Object &&
          classComponentBase === ReactClassComponentBase.Component &&
          isEntryDominatingNode(node, lifecycleMethod)
        ) {
          cycleStatus = ReactClassUpdateCycleStatus.Guaranteed;
        } else {
          cycleStatus = ReactClassUpdateCycleStatus.Unknown;
        }
      }
      const commitCallbackProvided = node.arguments.length > 1;
      const isSourceComplete =
        updater.updaterStatus !== ReactClassStateUpdaterStatus.Unknown && !commitCallbackProvided;
      transitions.push({
        callExpression: node,
        commitCallbackProvided,
        cycleStatus,
        guardNodes,
        isSourceComplete,
        phase,
        updaterFunction: updater.updaterFunction,
        updaterStatus: updater.updaterStatus,
      });
      return;
    }
    node.forEachChild(visit);
  };
  lifecycleMethod.forEachChild(visit);
  return transitions;
};

export const collectClassStateTransitions = (
  mountMethod: ts.MethodDeclaration | null,
  updateMethod: ts.MethodDeclaration | null,
  classComponentBase: ReactClassComponentBase,
  context: ReactAnalysisContext,
): ReadonlyArray<ClassStateTransitionDescriptor> => [
  ...collectMethodTransitions(
    mountMethod,
    ReactExecutionPhase.ClassMount,
    classComponentBase,
    context,
  ),
  ...collectMethodTransitions(
    updateMethod,
    ReactExecutionPhase.ClassUpdate,
    classComponentBase,
    context,
  ),
];
