import ts from "typescript";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectReactiveCaptures } from "./collect-reactive-captures.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import { isReactiveCaptureDeclared } from "./utils/is-reactive-capture-declared.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

export const analyzeEffectDependencies = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([
    ...hookBindings.effectEvents,
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
  ]);
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];

  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) {
      unknownEvidence.push(
        createEvidence(
          effectCall,
          context.rootDirectory,
          "The effect callback cannot be resolved",
          ["render", "register effect", "opaque callback"],
        ),
      );
      continue;
    }
    const dependenciesExpression = effectCall.arguments[1];
    if (!dependenciesExpression) continue;
    if (!ts.isArrayLiteralExpression(dependenciesExpression)) {
      unknownEvidence.push(
        createEvidence(
          dependenciesExpression,
          context.rootDirectory,
          "The effect dependency list is not an inline tuple",
          ["render", "register effect", "dynamic dependency list"],
        ),
      );
      continue;
    }
    const declaredDependencies = dependenciesExpression.elements.map((dependency) =>
      dependency.getText(),
    );
    const captures = collectReactiveCaptures(
      effectCallback,
      functionNode,
      context.typeChecker,
      stableSymbols,
    );
    for (const { key: captureKey, node: captureNode } of captures) {
      if (isReactiveCaptureDeclared(captureKey, declaredDependencies)) continue;
      violations.push(
        createEvidence(
          captureNode,
          context.rootDirectory,
          `${captureKey} is reactive but absent from the effect dependency list`,
          ["render capture", captureKey, "effect callback", "stale value"],
        ),
      );
    }
  }

  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.EffectDependencies,
      ReactObligationStatus.Violated,
      "An effect can observe a stale reactive value",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.EffectDependencies,
      ReactObligationStatus.Unknown,
      "Effect closure completeness could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.EffectDependencies,
    ReactObligationStatus.Proved,
    "Every effect capture is reactive, stable, or represented by a dependency",
  );
};
