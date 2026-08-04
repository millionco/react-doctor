import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactErrorBoundaryCoverageStatus,
  ReactObligationStatus,
  ReactProofClaim,
  ReactSuspenseCoverageStatus,
  ReactUseResourceIdentityStatus,
  ReactUseResourceKind,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeUseResource = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.UseResource,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify use resource topology",
    );
  }
  const resources = context.graph.useResources.filter(
    (resource) => resource.ownerId === semanticUnit.id,
  );
  const violatedEvidence: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const resource of resources) {
    if (resource.kind === ReactUseResourceKind.Invalid) {
      violatedEvidence.push({
        description: "use receives a value that is not a thenable or React Context",
        location: resource.location,
        trace: ["use", "invalid resource type", "unsupported render protocol"],
      });
    } else if (resource.kind === ReactUseResourceKind.Unknown) {
      unknownEvidence.push({
        description: "The type passed to use cannot be proved to be a thenable",
        location: resource.location,
        trace: ["use", "opaque resource type", "unknown suspension protocol"],
      });
    }
    if (resource.identityStatus === ReactUseResourceIdentityStatus.Unstable) {
      violatedEvidence.push({
        description: "use receives a Promise created during React execution",
        location: resource.location,
        trace: ["render", "fresh Promise identity", "repeated suspension or uncached resource"],
      });
    } else if (resource.identityStatus === ReactUseResourceIdentityStatus.Unknown) {
      unknownEvidence.push({
        description: "The resource passed to use has unresolved cache identity",
        location: resource.location,
        trace: ["use", "opaque Promise origin", "unknown identity stability"],
      });
    }
    if (resource.suspenseCoverageStatus === ReactSuspenseCoverageStatus.OutsideBoundary) {
      violatedEvidence.push({
        description: "A pending resource can suspend outside Suspense",
        location: resource.location,
        trace: ["use", "pending thenable", "missing Suspense fallback"],
      });
    } else if (resource.suspenseCoverageStatus === ReactSuspenseCoverageStatus.Unknown) {
      unknownEvidence.push({
        description: "A resource crosses unresolved Suspense topology",
        location: resource.location,
        trace: ["use", "opaque render or ReactNode placement", "unknown pending fallback"],
      });
    }
    if (resource.errorCoverageStatus === ReactErrorBoundaryCoverageStatus.OutsideBoundary) {
      violatedEvidence.push({
        description: "A rejected resource can escape without a valid Error Boundary",
        location: resource.location,
        trace: ["use", "rejected thenable", "missing recovery UI"],
      });
    } else if (resource.errorCoverageStatus === ReactErrorBoundaryCoverageStatus.Unknown) {
      unknownEvidence.push({
        description: "A resource crosses unresolved Error Boundary topology",
        location: resource.location,
        trace: ["use", "opaque render or ReactNode placement", "unknown rejection recovery"],
      });
    }
  }
  if (violatedEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.UseResource,
      ReactObligationStatus.Violated,
      "A use resource violates type, identity, Suspense, or Error Boundary requirements",
      violatedEvidence,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.UseResource,
      ReactObligationStatus.Unknown,
      "A use resource protocol crosses an opaque proof boundary",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.UseResource,
    ReactObligationStatus.Proved,
    resources.length > 0
      ? "Every use resource has stable thenable identity and complete pending and rejection coverage"
      : "The unit reads no Promise resource with use",
  );
};
