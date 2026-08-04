import ts from "typescript";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCallName } from "./get-call-name.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { isGuaranteedStateChange } from "./is-guaranteed-state-change.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isNodeWithin } from "./is-node-within.js";
import { ReactExecutionPhase, ReactObligationStatus, ReactProofClaim } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

const isUnconditionalCallbackCall = (
  callExpression: ts.CallExpression,
  callback: ts.FunctionLikeDeclaration,
): boolean => {
  if (!callback.body) return false;
  if (!ts.isBlock(callback.body)) return callback.body === callExpression;
  return (
    callback.body.statements.length === 1 &&
    ts.isExpressionStatement(callback.body.statements[0]) &&
    callback.body.statements[0].expression === callExpression
  );
};

const getDependencyRootIdentifier = (expression: ts.Expression): ts.Identifier | null => {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return getDependencyRootIdentifier(expression.expression);
  }
  return null;
};

const isParameterBinding = (declaration: ts.Declaration): boolean => {
  let currentNode: ts.Node | undefined = declaration;
  while (currentNode) {
    if (ts.isParameter(currentNode)) return true;
    if (isFunctionBoundary(currentNode)) return false;
    currentNode = currentNode.parent;
  }
  return false;
};

const isStableAcrossLocalStateUpdate = (
  dependency: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  stableSymbols: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (
    ts.isStringLiteral(dependency) ||
    ts.isNumericLiteral(dependency) ||
    dependency.kind === ts.SyntaxKind.TrueKeyword ||
    dependency.kind === ts.SyntaxKind.FalseKeyword ||
    dependency.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  const rootIdentifier = getDependencyRootIdentifier(dependency);
  if (!rootIdentifier) return false;
  const rootSymbol = typeChecker.getSymbolAtLocation(rootIdentifier);
  if (!rootSymbol) return false;
  if (stableSymbols.has(rootSymbol)) return true;
  const declarations = rootSymbol.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every(
      (declaration) => !isNodeWithin(declaration, functionNode) || isParameterBinding(declaration),
    )
  );
};

export const analyzeEffectStateUpdates = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const functionNode = unit.functionNode;
  if (!functionNode) {
    return createObligation(
      ReactProofClaim.EffectStateUpdates,
      ReactObligationStatus.Unknown,
      "The unit has no function boundary for an Effect transition proof",
    );
  }
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
    ...hookBindings.stateValues,
  ]);
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (context.graph && semanticOwnerId) {
    const callbacksById = new Map(
      context.graph.callbacks.map((callback) => [callback.id, callback]),
    );
    for (const propFlow of context.graph.callbackPropFlows) {
      if (
        propFlow.targetOwnerId !== semanticOwnerId ||
        propFlow.phase !== ReactExecutionPhase.EffectSetup
      ) {
        continue;
      }
      const stateWrites = propFlow.callbackIds.flatMap(
        (callbackId) => callbacksById.get(callbackId)?.stateWrites ?? [],
      );
      if (stateWrites.length === 0) continue;
      unknownEvidence.push({
        description: `Effect callback prop ${propFlow.propName} writes source-component state and requires a cross-component rerender fixpoint proof`,
        location: propFlow.location,
        trace: [
          "effect setup",
          `component prop ${propFlow.propName}`,
          ...stateWrites,
          "source component state update",
          "possible callback identity change",
          "possible effect rerun",
        ],
      });
    }
  }
  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) {
      unknownEvidence.push(
        createEvidence(
          effectCall,
          context.rootDirectory,
          "The effect callback cannot be checked for state-transition cycles",
          ["effect setup", "opaque callback", "unknown state transitions"],
        ),
      );
      continue;
    }
    for (const reachableFunction of collectReachableFunctions(
      effectCallback,
      context.typeChecker,
    )) {
      const visit = (node: ts.Node): void => {
        if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
        if (ts.isCallExpression(node)) {
          const callSymbol = context.typeChecker.getSymbolAtLocation(node.expression);
          if (callSymbol && hookBindings.stateSetters.has(callSymbol)) {
            const callName = getCallName(node) ?? "state setter";
            const dependenciesExpression = effectCall.arguments[1];
            if (
              dependenciesExpression &&
              ts.isArrayLiteralExpression(dependenciesExpression) &&
              dependenciesExpression.elements.length === 0
            ) {
              return;
            }
            const stateSymbol = hookBindings.stateValueBySetter.get(callSymbol);
            const hasDirectStateDependency =
              stateSymbol &&
              dependenciesExpression &&
              ts.isArrayLiteralExpression(dependenciesExpression) &&
              dependenciesExpression.elements.some(
                (dependency) => context.typeChecker.getSymbolAtLocation(dependency) === stateSymbol,
              );
            const hasUnstableDependency =
              dependenciesExpression &&
              ts.isArrayLiteralExpression(dependenciesExpression) &&
              dependenciesExpression.elements.some(
                (dependency) =>
                  !isStableAcrossLocalStateUpdate(
                    dependency,
                    functionNode,
                    stableSymbols,
                    context.typeChecker,
                  ),
              );
            const canSelfTrigger =
              !dependenciesExpression ||
              !ts.isArrayLiteralExpression(dependenciesExpression) ||
              Boolean(hasDirectStateDependency) ||
              Boolean(hasUnstableDependency);
            if (!canSelfTrigger) return;
            if (
              reachableFunction.functionNode === effectCallback &&
              !reachableFunction.isConditionallyReached &&
              stateSymbol &&
              canSelfTrigger &&
              isUnconditionalCallbackCall(node, effectCallback) &&
              isGuaranteedStateChange({
                callExpression: node,
                stateSymbol,
                typeChecker: context.typeChecker,
              })
            ) {
              violations.push(
                createEvidence(
                  node,
                  context.rootDirectory,
                  `${callName} necessarily changes a dependency that schedules this effect again`,
                  [
                    "effect setup",
                    callName,
                    "guaranteed state change",
                    "dependency changed",
                    "effect setup",
                  ],
                ),
              );
              return;
            }
            unknownEvidence.push(
              createEvidence(
                node,
                context.rootDirectory,
                `${callName} requires a state-transition and rerender fixpoint proof`,
                ["effect setup", callName, "state update", "possible effect rerun"],
              ),
            );
            return;
          }
        }
        node.forEachChild(visit);
      };
      reachableFunction.functionNode.forEachChild(visit);
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.EffectStateUpdates,
      ReactObligationStatus.Violated,
      "An effect contains a guaranteed self-triggering state transition",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.EffectStateUpdates,
      ReactObligationStatus.Unknown,
      "An effect directly updates component state without a transition proof",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.EffectStateUpdates,
    ReactObligationStatus.Proved,
    "Every direct effect state update is absent or bounded to mount",
  );
};
