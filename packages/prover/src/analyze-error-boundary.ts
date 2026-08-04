import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactErrorBoundaryCoverageStatus,
  ReactErrorBoundaryProtocolStatus,
  ReactObligationStatus,
  ReactProofClaim,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeErrorBoundary = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.ErrorBoundary,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify render-error topology",
    );
  }
  const definitions = context.graph.errorBoundaryDefinitions.filter(
    (definition) => definition.ownerId === semanticUnit.id,
  );
  const failures = context.graph.renderFailures.filter(
    (failure) => failure.ownerId === semanticUnit.id,
  );
  const violatedEvidence: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const definition of definitions) {
    if (
      definition.derivedStateStatus === ReactErrorBoundaryProtocolStatus.Invalid ||
      definition.fallbackRenderStatus === ReactErrorBoundaryProtocolStatus.Invalid
    ) {
      violatedEvidence.push({
        description: "An Error Boundary cannot deterministically transition to fallback UI",
        location: definition.location,
        trace: [
          "rendering error",
          "invalid getDerivedStateFromError or fallback guard",
          "missing recovery UI",
        ],
      });
    } else if (!definition.complete) {
      unknownEvidence.push({
        description: "An Error Boundary recovery protocol crosses opaque state or render flow",
        location: definition.location,
        trace: ["rendering error", "opaque boundary state transition", "unknown recovery UI"],
      });
    }
  }
  for (const failure of failures) {
    if (failure.coverageStatus === ReactErrorBoundaryCoverageStatus.OutsideBoundary) {
      violatedEvidence.push({
        description: "A reachable render failure can escape without a valid Error Boundary",
        location: failure.location,
        trace: ["client render", "explicit throw", "unmounted application UI"],
      });
    } else if (failure.coverageStatus === ReactErrorBoundaryCoverageStatus.Unknown) {
      unknownEvidence.push({
        description: "A render failure crosses unresolved Error Boundary topology",
        location: failure.location,
        trace: ["client render", "explicit throw", "opaque component or ReactNode placement"],
      });
    }
  }
  if (violatedEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ErrorBoundary,
      ReactObligationStatus.Violated,
      "Render-error recovery is invalid or incomplete",
      violatedEvidence,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ErrorBoundary,
      ReactObligationStatus.Unknown,
      "Render-error recovery crosses an opaque proof boundary",
      unknownEvidence,
    );
  }
  let description = "The unit has no modeled render failure or Error Boundary";
  if (failures.length > 0) {
    description = "Every modeled client render failure is contained by a valid Error Boundary";
  } else if (definitions.length > 0) {
    description = "Every Error Boundary has a total fallback-state protocol";
  }
  return createObligation(ReactProofClaim.ErrorBoundary, ReactObligationStatus.Proved, description);
};
