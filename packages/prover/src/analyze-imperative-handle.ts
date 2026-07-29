import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactImperativeHandleStatus, ReactObligationStatus, ReactProofClaim } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeImperativeHandle = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!semanticUnit || !context.graph) {
    return createObligation(
      ReactProofClaim.ImperativeHandle,
      ReactObligationStatus.Unknown,
      "Imperative handle ownership has no semantic graph",
    );
  }
  const handles = context.graph.imperativeHandles.filter(
    (handle) => handle.ownerId === semanticUnit.id,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const handle of handles) {
    if (handle.status === ReactImperativeHandleStatus.MissingDependency) {
      violations.push({
        description: `${handle.refName ?? "The imperative handle"} can expose stale reactive values because its dependency list is incomplete`,
        location: handle.location,
        trace: ["useImperativeHandle", "reactive factory capture", "stale exposed handle"],
      });
    } else if (handle.status === ReactImperativeHandleStatus.ImpureFactory) {
      violations.push({
        description: `${handle.refName ?? "The imperative handle"} creates its handle with an observable side effect`,
        location: handle.location,
        trace: ["layout commit", "createHandle", "non-repeat-safe side effect"],
      });
    } else if (!handle.complete) {
      unknownEvidence.push({
        description: `${handle.refName ?? "The imperative handle"} crosses an unresolved ref binding, method, invocation, or external render boundary`,
        location: handle.location,
        trace: [
          "useImperativeHandle",
          handle.status,
          handle.sourceComplete ? "known source" : "open ref protocol",
        ],
      });
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ImperativeHandle,
      ReactObligationStatus.Violated,
      "An imperative handle can become stale or repeat an unsafe factory side effect",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ImperativeHandle,
      ReactObligationStatus.Unknown,
      "Imperative handle ownership or invocation coverage is incomplete",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ImperativeHandle,
    ReactObligationStatus.Proved,
    handles.length > 0
      ? "Every imperative handle has a closed factory, ref binding, and invocation protocol"
      : "The unit exposes no imperative handle",
  );
};
