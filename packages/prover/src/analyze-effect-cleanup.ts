import ts from "typescript";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCallName } from "./get-call-name.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

interface ResourceAcquisition {
  node: ts.Node;
  description: string;
  cleanupNames: ReadonlyArray<string>;
  isConditionallyReached: boolean;
  ownerFunction: ts.FunctionLikeDeclaration;
  eventListener?: EventListenerIdentity;
}

interface EventListenerIdentity {
  targetText: string;
  eventText: string;
  handler: ts.Expression;
  optionsText: string;
}

const getAssignedName = (expression: ts.Expression): string | null => {
  const parentNode = expression.parent;
  if (
    ts.isVariableDeclaration(parentNode) &&
    parentNode.initializer === expression &&
    ts.isIdentifier(parentNode.name)
  ) {
    return parentNode.name.text;
  }
  if (
    ts.isBinaryExpression(parentNode) &&
    parentNode.right === expression &&
    parentNode.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parentNode.left)
  ) {
    return parentNode.left.text;
  }
  return null;
};

const getEventListenerIdentity = (
  callExpression: ts.CallExpression,
): EventListenerIdentity | null => {
  if (
    !ts.isPropertyAccessExpression(callExpression.expression) ||
    callExpression.expression.name.text !== "addEventListener"
  ) {
    return null;
  }
  const eventExpression = callExpression.arguments[0];
  const handlerExpression = callExpression.arguments[1];
  if (!eventExpression || !handlerExpression) return null;
  return {
    targetText: callExpression.expression.expression.getText(),
    eventText: eventExpression.getText(),
    handler: handlerExpression,
    optionsText: callExpression.arguments[2]?.getText() ?? "",
  };
};

const getCanonicalCall = (callExpression: ts.CallExpression): string => {
  const callName = getCallName(callExpression) ?? callExpression.expression.getText();
  const argumentsText = callExpression.arguments.map((argument) => argument.getText()).join(",");
  return `${callName}(${argumentsText})`;
};

const collectResourceAcquisitions = (
  effectCallback: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ResourceAcquisition> => {
  const acquisitions: ResourceAcquisition[] = [];
  for (const reachableFunction of collectReachableFunctions(effectCallback, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      if (ts.isCallExpression(node)) {
        const callName = getCallName(node);
        const eventListener = getEventListenerIdentity(node);
        if (eventListener) {
          acquisitions.push({
            node,
            description: `${callName ?? "addEventListener"} registration`,
            cleanupNames: [
              `${eventListener.targetText}.removeEventListener(${eventListener.eventText}, same handler and options)`,
            ],
            isConditionallyReached: reachableFunction.isConditionallyReached,
            ownerFunction: reachableFunction.functionNode,
            eventListener,
          });
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "subscribe"
        ) {
          const assignedName = getAssignedName(node);
          acquisitions.push({
            node,
            description: `${callName ?? "subscribe"} subscription`,
            cleanupNames: assignedName
              ? [`${assignedName}()`, `${assignedName}.unsubscribe()`]
              : [],
            isConditionallyReached: reachableFunction.isConditionallyReached,
            ownerFunction: reachableFunction.functionNode,
          });
        }
      }
      if (ts.isNewExpression(node)) {
        const constructorName = node.expression.getText();
        if (
          constructorName === "IntersectionObserver" ||
          constructorName === "MutationObserver" ||
          constructorName === "ResizeObserver" ||
          constructorName === "EventSource" ||
          constructorName === "WebSocket"
        ) {
          const assignedName = getAssignedName(node);
          const cleanupMethod = constructorName.endsWith("Observer") ? "disconnect" : "close";
          acquisitions.push({
            node,
            description: `${constructorName} resource`,
            cleanupNames: assignedName ? [`${assignedName}.${cleanupMethod}()`] : [],
            isConditionallyReached: reachableFunction.isConditionallyReached,
            ownerFunction: reachableFunction.functionNode,
          });
        }
      }
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return acquisitions;
};

const isSameExpressionIdentity = (
  leftExpression: ts.Expression,
  rightExpression: ts.Expression,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (leftExpression === rightExpression) return true;
  if (!ts.isIdentifier(leftExpression) || !ts.isIdentifier(rightExpression)) return false;
  const leftSymbol = typeChecker.getSymbolAtLocation(leftExpression);
  const rightSymbol = typeChecker.getSymbolAtLocation(rightExpression);
  return Boolean(leftSymbol && leftSymbol === rightSymbol);
};

const hasMatchingEventListenerCleanup = (
  eventListener: EventListenerIdentity,
  cleanupCalls: ReadonlyArray<ts.CallExpression>,
  typeChecker: ts.TypeChecker,
): boolean =>
  cleanupCalls.some((cleanupCall) => {
    if (
      !ts.isPropertyAccessExpression(cleanupCall.expression) ||
      cleanupCall.expression.name.text !== "removeEventListener" ||
      cleanupCall.expression.expression.getText() !== eventListener.targetText
    ) {
      return false;
    }
    const cleanupEvent = cleanupCall.arguments[0];
    const cleanupHandler = cleanupCall.arguments[1];
    if (!cleanupEvent || !cleanupHandler) return false;
    return (
      cleanupEvent.getText() === eventListener.eventText &&
      isSameExpressionIdentity(eventListener.handler, cleanupHandler, typeChecker) &&
      (cleanupCall.arguments[2]?.getText() ?? "") === eventListener.optionsText
    );
  });

const hasConditionalAncestor = (node: ts.Node, owner: ts.FunctionLikeDeclaration): boolean => {
  let currentNode = node;
  while (currentNode !== owner) {
    const parentNode = currentNode.parent;
    if (!parentNode) return true;
    if (
      ts.isIfStatement(parentNode) ||
      ts.isConditionalExpression(parentNode) ||
      ts.isSwitchStatement(parentNode) ||
      ts.isForStatement(parentNode) ||
      ts.isForInStatement(parentNode) ||
      ts.isForOfStatement(parentNode) ||
      ts.isWhileStatement(parentNode) ||
      ts.isDoStatement(parentNode) ||
      ts.isTryStatement(parentNode)
    ) {
      return true;
    }
    currentNode = parentNode;
  }
  return false;
};

export const analyzeEffectCleanup = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];

  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) {
      unknownEvidence.push(
        createEvidence(
          effectCall,
          context.rootDirectory,
          "The effect callback cannot be resolved for lifecycle analysis",
          ["effect setup", "opaque callback", "cleanup"],
        ),
      );
      continue;
    }
    const cleanupFunctions = collectEffectCleanupFunctions(effectCallback, context.typeChecker);
    const cleanupCallExpressions = cleanupFunctions.flatMap((cleanupFunction) =>
      collectReachableCallExpressions(cleanupFunction, context.typeChecker),
    );
    const cleanupCalls = new Set(cleanupCallExpressions.map(getCanonicalCall));
    for (const acquisition of collectResourceAcquisitions(effectCallback, context.typeChecker)) {
      if (
        acquisition.isConditionallyReached ||
        hasConditionalAncestor(acquisition.node, acquisition.ownerFunction)
      ) {
        unknownEvidence.push(
          createEvidence(
            acquisition.node,
            context.rootDirectory,
            `${acquisition.description} is path-dependent`,
            ["effect setup branch", acquisition.description, "cleanup branch"],
          ),
        );
        continue;
      }
      const hasMatchingCleanup = acquisition.eventListener
        ? hasMatchingEventListenerCleanup(
            acquisition.eventListener,
            cleanupCallExpressions,
            context.typeChecker,
          )
        : acquisition.cleanupNames.some((cleanupName) => cleanupCalls.has(cleanupName));
      if (!hasMatchingCleanup) {
        violations.push(
          createEvidence(
            acquisition.node,
            context.rootDirectory,
            `${acquisition.description} has no cleanup with the same resource identity`,
            [
              "effect setup",
              acquisition.description,
              acquisition.cleanupNames.join(" or ") || "unresolvable resource identity",
              "effect cleanup",
            ],
          ),
        );
      }
    }
  }

  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Violated,
      "An effect can retain a resource after cleanup or unmount",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Unknown,
      "Effect resource symmetry could not be proved on every path",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.EffectCleanup,
    ReactObligationStatus.Proved,
    "Every modeled effect resource has symmetric cleanup",
  );
};
