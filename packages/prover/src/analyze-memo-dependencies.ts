import ts from "typescript";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectHookCalls } from "./collect-hook-calls.js";
import { collectReactiveCaptures } from "./collect-reactive-captures.js";
import { REACT_MEMO_HOOK_NAMES } from "./constants.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

export const analyzeMemoDependencies = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([...hookBindings.refs, ...hookBindings.stateSetters]);
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const memoCall of collectHookCalls(
    functionNode,
    REACT_MEMO_HOOK_NAMES,
    context.typeChecker,
  )) {
    const hookName = getCanonicalHookName(memoCall, context.typeChecker) ?? "memo hook";
    const callbackExpression = memoCall.arguments[0];
    const callback = callbackExpression
      ? resolveFunction(callbackExpression, context.typeChecker)
      : null;
    if (!callback) {
      unknownEvidence.push(
        createEvidence(
          memoCall,
          context.rootDirectory,
          `The ${hookName} callback cannot be resolved`,
          ["render", hookName, "opaque callback"],
        ),
      );
      continue;
    }
    const dependencyExpression = memoCall.arguments[1];
    if (!dependencyExpression || !ts.isArrayLiteralExpression(dependencyExpression)) {
      unknownEvidence.push(
        createEvidence(
          dependencyExpression ?? memoCall,
          context.rootDirectory,
          `${hookName} does not have an inline dependency tuple`,
          ["render", hookName, "dynamic dependency list"],
        ),
      );
      continue;
    }
    const declaredDependencies = new Set(
      dependencyExpression.elements.map((dependency) => dependency.getText()),
    );
    const captures = collectReactiveCaptures(
      callback,
      functionNode,
      context.typeChecker,
      stableSymbols,
    );
    for (const capture of captures) {
      const isDeclared = [...declaredDependencies].some(
        (dependency) =>
          dependency === capture.key ||
          capture.key.startsWith(`${dependency}.`) ||
          dependency.startsWith(`${capture.key}.`),
      );
      if (isDeclared) continue;
      violations.push(
        createEvidence(
          capture.node,
          context.rootDirectory,
          `${capture.key} is reactive but absent from the ${hookName} dependency list`,
          ["render capture", capture.key, hookName, "stale closure"],
        ),
      );
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.MemoDependencies,
      ReactObligationStatus.Violated,
      "A memoized callback or value can observe a stale reactive value",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.MemoDependencies,
      ReactObligationStatus.Unknown,
      "Memo closure completeness could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.MemoDependencies,
    ReactObligationStatus.Proved,
    "Every memo closure capture is stable or represented by a dependency",
  );
};
