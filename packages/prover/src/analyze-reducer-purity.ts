import ts from "typescript";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
import { collectHookCalls } from "./collect-hook-calls.js";
import { REACT_REDUCER_HOOK_NAMES } from "./constants.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

const analyzeReducerFunction = (
  expression: ts.Expression | undefined,
  label: string,
  call: ts.CallExpression,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const reducerFunction = expression ? resolveFunction(expression, context.typeChecker) : null;
  if (!reducerFunction) {
    return createObligation(
      ReactProofClaim.ReducerPurity,
      ReactObligationStatus.Unknown,
      `${label} purity could not be proved`,
      [
        createEvidence(
          expression ?? call,
          context.rootDirectory,
          `The ${label} function cannot be resolved`,
          ["useReducer", label, "opaque transition"],
        ),
      ],
    );
  }
  return analyzeRenderPurity(reducerFunction, context);
};

export const analyzeReducerPurity = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const reducerCall of collectHookCalls(
    functionNode,
    REACT_REDUCER_HOOK_NAMES,
    context.typeChecker,
  )) {
    const reducerProof = analyzeReducerFunction(
      reducerCall.arguments[0],
      "reducer",
      reducerCall,
      context,
    );
    if (reducerProof.status === ReactObligationStatus.Violated) {
      violations.push(...reducerProof.evidence);
    } else if (reducerProof.status === ReactObligationStatus.Unknown) {
      unknownEvidence.push(...reducerProof.evidence);
    }
    const initializerExpression = reducerCall.arguments[2];
    if (initializerExpression) {
      const initializerProof = analyzeReducerFunction(
        initializerExpression,
        "reducer initializer",
        reducerCall,
        context,
      );
      if (initializerProof.status === ReactObligationStatus.Violated) {
        violations.push(...initializerProof.evidence);
      } else if (initializerProof.status === ReactObligationStatus.Unknown) {
        unknownEvidence.push(...initializerProof.evidence);
      }
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ReducerPurity,
      ReactObligationStatus.Violated,
      "A reducer transition is not pure",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ReducerPurity,
      ReactObligationStatus.Unknown,
      "Reducer purity depends on an opaque transition",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ReducerPurity,
    ReactObligationStatus.Proved,
    "Every reducer and initializer transition is pure",
  );
};
