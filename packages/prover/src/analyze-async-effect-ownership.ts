import ts from "typescript";
import { collectAsyncEffectTaskDescriptors } from "./collect-async-effect-task-descriptors.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { ReactAsyncOwnershipStatus, ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

export const analyzeAsyncEffectOwnership = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const tasks = collectAsyncEffectTaskDescriptors(functionNode, context);
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const task of tasks) {
    if (task.status === ReactAsyncOwnershipStatus.Guarded) continue;
    const evidence = createEvidence(
      task.evidenceNode,
      context.rootDirectory,
      task.evidenceDescription,
      [
        "effect setup",
        "async continuation",
        "suspension or deferred callback",
        task.status === ReactAsyncOwnershipStatus.Unknown
          ? "unclassified ownership"
          : "unguarded stale state write",
        "effect cleanup or replacement",
      ],
    );
    if (task.status === ReactAsyncOwnershipStatus.Unknown) unknownEvidence.push(evidence);
    else violations.push(evidence);
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.AsyncEffectOwnership,
      ReactObligationStatus.Violated,
      "An async Effect task can write state after losing ownership",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.AsyncEffectOwnership,
      ReactObligationStatus.Unknown,
      "Async Effect ownership contains an unclassified continuation",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.AsyncEffectOwnership,
    ReactObligationStatus.Proved,
    "Every modeled async Effect state write is invalidated before replacement",
  );
};
