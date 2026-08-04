import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactEffectResourceDisposalStatus,
  ReactObligationStatus,
  ReactProofClaim,
} from "./types.js";
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
  for (const resource of resources) {
    const lifecycleKind = resource.effectId ? "effect" : "class lifecycle";
    const evidence: ReactProofEvidence = {
      description:
        resource.disposalStatus === ReactEffectResourceDisposalStatus.Missing
          ? `${resource.kind} has no cleanup with the same resource identity`
          : `${resource.kind} is path-dependent or has no complete callback and disposal certificate`,
      location: resource.location,
      trace: [
        `${lifecycleKind} setup`,
        resource.kind,
        "deferred callback",
        `${lifecycleKind} cleanup or replacement`,
      ],
    };
    if (resource.disposalStatus === ReactEffectResourceDisposalStatus.Missing) {
      violations.push(evidence);
    } else if (!resource.complete) {
      unknownEvidence.push(evidence);
    }
  }
  const classLifecycle = context.graph.classLifecycles.find(
    (lifecycle) => lifecycle.ownerId === semanticOwnerId,
  );
  if (classLifecycle && !classLifecycle.sourceComplete) {
    unknownEvidence.push({
      description: "The class lifecycle contains an unmodeled method or ownership transition",
      location: classLifecycle.location,
      trace: ["class lifecycle", "unmodeled execution", "cleanup completeness unknown"],
    });
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Violated,
      "A lifecycle resource can remain active after cleanup or unmount",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.EffectCleanup,
      ReactObligationStatus.Unknown,
      "A lifecycle resource callback or disposal path could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.EffectCleanup,
    ReactObligationStatus.Proved,
    "Every modeled lifecycle resource has a deferred callback and guaranteed disposal",
  );
};
