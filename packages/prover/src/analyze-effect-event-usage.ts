import ts from "typescript";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectEffectEventBindings } from "./collect-effect-event-bindings.js";
import { collectEventCallbackFunctions } from "./collect-event-callback-functions.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { EFFECT_EVENT_REGISTRATION_CALL_NAMES } from "./constants.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCallName } from "./get-call-name.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isNodeWithin } from "./is-node-within.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

const isEffectDependencyReference = (
  identifier: ts.Identifier,
  effectCalls: ReadonlyArray<ts.CallExpression>,
): boolean =>
  effectCalls.some((effectCall) => {
    const dependencyExpression = effectCall.arguments[1];
    return Boolean(dependencyExpression && isNodeWithin(identifier, dependencyExpression));
  });

const isDirectInvocation = (identifier: ts.Identifier): boolean =>
  ts.isCallExpression(identifier.parent) && identifier.parent.expression === identifier;

const isRegistrationArgument = (identifier: ts.Identifier): boolean => {
  const callExpression = identifier.parent;
  if (!ts.isCallExpression(callExpression) || !callExpression.arguments.includes(identifier)) {
    return false;
  }
  const callName = getCallName(callExpression)?.split(".").at(-1);
  return Boolean(callName && EFFECT_EVENT_REGISTRATION_CALL_NAMES.has(callName));
};

const getWrapperName = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): string | null => {
  if (!ts.isCallExpression(functionNode.parent)) return null;
  const directSymbol = typeChecker.getSymbolAtLocation(functionNode.parent.expression);
  const wrapperSymbol =
    directSymbol && (directSymbol.flags & ts.SymbolFlags.Alias) !== 0
      ? typeChecker.getAliasedSymbol(directSymbol)
      : directSymbol;
  return wrapperSymbol?.name ?? getCallName(functionNode.parent)?.split(".").at(-1) ?? null;
};

const collectContextValueSymbols = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlySet<ts.Symbol> => {
  const contextValueSymbols = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      getCanonicalHookName(node.initializer, typeChecker) === "useContext"
    ) {
      const contextValueSymbol = typeChecker.getSymbolAtLocation(node.name);
      if (contextValueSymbol) contextValueSymbols.add(contextValueSymbol);
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return contextValueSymbols;
};

const getContainingFunction = (node: ts.Node): ts.FunctionLikeDeclaration | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isFunctionBoundary(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

export const analyzeEffectEventUsage = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const bindings = collectEffectEventBindings(functionNode, context.typeChecker);
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  const effectCalls = collectEffectCalls(functionNode, context.typeChecker);
  const effectCallbacks = effectCalls
    .map((effectCall) => getEffectCallback(effectCall, context.typeChecker))
    .filter((callback) => callback !== null);
  const effectEventCallbacks = bindings
    .map((binding) => binding.callback)
    .filter((callback) => callback !== null);
  const effectCleanupCallbacks = effectCallbacks.flatMap((callback) =>
    collectEffectCleanupFunctions(callback, context.typeChecker),
  );
  const allowedOwners = new Set(
    [...effectCallbacks, ...effectCleanupCallbacks, ...effectEventCallbacks].flatMap((callback) =>
      collectReachableFunctions(callback, context.typeChecker).map(
        (reachableFunction) => reachableFunction.functionNode,
      ),
    ),
  );
  const eventOwners = new Set(
    collectEventCallbackFunctions(functionNode, context.typeChecker).flatMap((callback) =>
      collectReachableFunctions(callback, context.typeChecker).map(
        (reachableFunction) => reachableFunction.functionNode,
      ),
    ),
  );
  const wrapperName = getWrapperName(functionNode, context.typeChecker);
  const contextValueSymbols = collectContextValueSymbols(functionNode, context.typeChecker);

  for (const binding of bindings) {
    if (!binding.callback) {
      unknownEvidence.push(
        createEvidence(
          binding.callExpression,
          context.rootDirectory,
          `${binding.name} has an opaque Effect Event callback`,
          ["render", "useEffectEvent", "opaque callback", "latest committed values"],
        ),
      );
    }
    if (
      binding.callback &&
      (wrapperName === "memo" || wrapperName === "forwardRef") &&
      contextValueSymbols.size > 0
    ) {
      unknownEvidence.push(
        createEvidence(
          binding.callback,
          context.rootDirectory,
          `The pinned React runtime can expose a stale context capture to an Effect Event through ${wrapperName}`,
          [
            wrapperName,
            "context update",
            "component render",
            "Effect Event invocation",
            "stale committed capture",
          ],
        ),
      );
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        isIdentifierReference(node) &&
        context.typeChecker.getSymbolAtLocation(node) === binding.symbol
      ) {
        if (isEffectDependencyReference(node, effectCalls)) {
          violations.push(
            createEvidence(
              node,
              context.rootDirectory,
              `${binding.name} has intentionally unstable identity and cannot be an Effect dependency`,
              [
                "render",
                binding.name,
                "Effect dependency",
                "identity changes",
                "effect resynchronization",
              ],
            ),
          );
          return;
        }
        const containingFunction = getContainingFunction(node);
        const isAllowedOwner = Boolean(containingFunction && allowedOwners.has(containingFunction));
        const isEventOwner = Boolean(containingFunction && eventOwners.has(containingFunction));
        if (
          isAllowedOwner &&
          !isEventOwner &&
          (isDirectInvocation(node) || isRegistrationArgument(node))
        ) {
          return;
        }
        if (isAllowedOwner && !isEventOwner) {
          unknownEvidence.push(
            createEvidence(
              node,
              context.rootDirectory,
              `${binding.name} crosses an unmodeled registration or alias boundary inside Effect logic`,
              ["Effect or Effect Event", binding.name, "opaque invocation lifetime"],
            ),
          );
          return;
        }
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${binding.name} is used outside an Effect or Effect Event`,
            ["useEffectEvent", binding.name, "invalid execution phase"],
          ),
        );
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }

  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.EffectEventUsage,
      ReactObligationStatus.Violated,
      "An Effect Event is used outside its local effect lifecycle",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.EffectEventUsage,
      ReactObligationStatus.Unknown,
      "Effect Event callback semantics could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.EffectEventUsage,
    ReactObligationStatus.Proved,
    "Every Effect Event remains local to Effects and reads the latest committed captures",
  );
};
