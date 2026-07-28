import { collectEffectSchedulerProtocols } from "./collect-effect-scheduler-protocols.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { getNodeLocation } from "./get-node-location.js";
import {
  ReactObligationStatus,
  ReactProofClaim,
  ReactSchedulerCancellationStatus,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
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
  for (const protocol of collectEffectSchedulerProtocols(functionNode, context)) {
    const registrationLocation = getNodeLocation(protocol.registrationCall, context.rootDirectory);
    const schedulerFact = schedulerFacts.find((scheduler) =>
      areProofLocationsEqual(scheduler.location, registrationLocation),
    );
    const evidence = createEvidence(
      protocol.registrationCall,
      context.rootDirectory,
      protocol.cancellationStatus === ReactSchedulerCancellationStatus.Missing
        ? `${protocol.kind} can remain active after its Effect loses ownership`
        : `${protocol.kind} has no complete deferred callback and cancellation certificate`,
      ["effect setup", protocol.kind, "deferred callback", "effect cleanup or replacement"],
    );
    if (protocol.cancellationStatus === ReactSchedulerCancellationStatus.Missing) {
      violations.push(evidence);
    } else if (!schedulerFact?.complete) {
      unknownEvidence.push(evidence);
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ScheduledCallbackLifetime,
      ReactObligationStatus.Violated,
      "An Effect scheduler can invoke work after losing lifecycle ownership",
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
    "Every modeled Effect scheduler has a deferred callback and guaranteed cancellation",
  );
};
