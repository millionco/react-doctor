import { collectEffectResourceProtocols } from "./collect-effect-resource-protocols.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { getNodeLocation } from "./get-node-location.js";
import {
  ReactEffectResourceDisposalStatus,
  ReactObligationStatus,
  ReactProofClaim,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeEffectCleanup = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const functionNode = unit.functionNode;
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (!functionNode || !context.graph || !semanticOwnerId) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Unknown,
      "Effect resource ownership has no semantic owner",
    );
  }
  const effects = context.graph.effects.filter((effect) => effect.ownerId === semanticOwnerId);
  const resources = context.graph.resources.filter(
    (resource) => resource.ownerId === semanticOwnerId,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const effect of effects) {
    if (effect.callbackResolved) continue;
    unknownEvidence.push({
      description: "The effect callback cannot be resolved for lifecycle analysis",
      location: effect.location,
      trace: ["effect setup", "opaque callback", "effect cleanup"],
    });
  }
  for (const protocol of collectEffectResourceProtocols(functionNode, context)) {
    const acquisitionLocation = getNodeLocation(protocol.acquisitionNode, context.rootDirectory);
    const resource = resources.find((candidate) =>
      areProofLocationsEqual(candidate.location, acquisitionLocation),
    );
    const evidence = createEvidence(
      protocol.acquisitionNode,
      context.rootDirectory,
      protocol.disposalStatus === ReactEffectResourceDisposalStatus.Missing
        ? `${protocol.kind} has no cleanup with the same resource identity`
        : `${protocol.kind} is path-dependent or has no complete callback and disposal certificate`,
      ["effect setup", protocol.kind, "deferred callback", "effect cleanup or replacement"],
    );
    if (protocol.disposalStatus === ReactEffectResourceDisposalStatus.Missing) {
      violations.push(evidence);
    } else if (!resource?.complete) {
      unknownEvidence.push(evidence);
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Violated,
      "An Effect resource can remain active after cleanup or unmount",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Unknown,
      "An Effect resource callback or disposal path could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.EffectCleanup,
    ReactObligationStatus.Proved,
    "Every modeled Effect resource has a deferred callback and guaranteed disposal",
  );
};
