import { collectCallableRefProtocols } from "./collect-callable-ref-protocols.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { getNodeLocation } from "./get-node-location.js";
import { ReactCallableRefFreshness, ReactObligationStatus, ReactProofClaim } from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeCallableRefFreshness = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const functionNode = unit.functionNode;
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (!functionNode || !context.graph || !semanticOwnerId) {
    return createObligation(
      ReactProofClaim.CallableRefFreshness,
      ReactObligationStatus.Unknown,
      "Callable ref freshness has no semantic owner",
    );
  }
  const callableRefs = context.graph.callableRefs.filter(
    (callableRef) => callableRef.ownerId === semanticOwnerId,
  );
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const protocol of collectCallableRefProtocols(functionNode, context.typeChecker)) {
    const protocolLocation = getNodeLocation(protocol.declaration, context.rootDirectory);
    const callableRef = callableRefs.find((candidate) =>
      areProofLocationsEqual(candidate.location, protocolLocation),
    );
    if (callableRef?.complete) continue;
    const description =
      callableRef?.freshness === ReactCallableRefFreshness.PassiveLag
        ? `${protocol.refName} is updated by a passive Effect after committed UI can become observable`
        : `${protocol.refName} does not have a complete render, commit, and event freshness proof`;
    unknownEvidence.push(
      createEvidence(protocol.declaration, context.rootDirectory, description, [
        `callable ref ${protocol.refName}`,
        protocol.updateHookName ?? "unknown write phase",
        "callback invocation",
        "unknown committed callback version",
      ]),
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.CallableRefFreshness,
      ReactObligationStatus.Unknown,
      "A callable ref may expose an unknown or stale callback version",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.CallableRefFreshness,
    ReactObligationStatus.Proved,
    "Every callable ref is synchronized before its modeled event channels",
  );
};
