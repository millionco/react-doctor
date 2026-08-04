import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactObligationStatus,
  ReactProofClaim,
  ReactSchedulerCancellationStatus,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeScheduledCallbackLifetime = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const functionNode = unit.functionNode;
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (!functionNode || !context.graph || !semanticOwnerId) {
    return createObligation(
      ReactProofClaim.ScheduledCallbackLifetime,
      ReactObligationStatus.Unknown,
      "Scheduled callback lifetime has no semantic owner",
    );
  }
  const schedulerFacts = context.graph.schedulers.filter(
    (scheduler) => scheduler.ownerId === semanticOwnerId,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const scheduler of schedulerFacts) {
    const lifecycleKind = scheduler.effectId ? "effect" : "class lifecycle";
    const evidence: ReactProofEvidence = {
      description:
        scheduler.cancellationStatus === ReactSchedulerCancellationStatus.Missing
          ? `${scheduler.kind} can remain active after its lifecycle loses ownership`
          : `${scheduler.kind} has no complete deferred callback and cancellation certificate`,
      location: scheduler.location,
      trace: [
        `${lifecycleKind} setup`,
        scheduler.kind,
        "deferred callback",
        `${lifecycleKind} cleanup or replacement`,
      ],
    };
    if (scheduler.cancellationStatus === ReactSchedulerCancellationStatus.Missing) {
      violations.push(evidence);
    } else if (!scheduler.complete) {
      unknownEvidence.push(evidence);
    }
  }
  const classLifecycle = context.graph.classLifecycles.find(
    (lifecycle) => lifecycle.ownerId === semanticOwnerId,
  );
  if (classLifecycle && !classLifecycle.sourceComplete) {
    unknownEvidence.push({
      description: "The class lifecycle contains an unmodeled scheduler or ownership transition",
      location: classLifecycle.location,
      trace: ["class lifecycle", "unmodeled execution", "scheduler lifetime unknown"],
    });
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ScheduledCallbackLifetime,
      ReactObligationStatus.Violated,
      "A scheduler can invoke work after losing lifecycle ownership",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ScheduledCallbackLifetime,
      ReactObligationStatus.Unknown,
      "A scheduled callback or cancellation path could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ScheduledCallbackLifetime,
    ReactObligationStatus.Proved,
    "Every modeled lifecycle scheduler has a deferred callback and guaranteed cancellation",
  );
};
