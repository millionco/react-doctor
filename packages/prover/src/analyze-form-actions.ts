import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactFormActionStatus, ReactObligationStatus, ReactProofClaim } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeFormActions = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const owner = findSemanticUnit(unit, context);
  const actions = owner
    ? (context.graph?.formActions.filter((action) => action.ownerId === owner.id) ?? [])
    : [];
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const action of actions) {
    if (action.status === ReactFormActionStatus.UnsupportedControl) {
      violations.push({
        description: `${action.propName} is attached to an intrinsic element that cannot invoke that Form Action`,
        location: action.location,
        trace: ["committed form", action.propName, action.kind, "unsupported submit control"],
      });
    } else if (!action.complete) {
      unknownEvidence.push({
        description: `${action.propName} does not resolve to a complete project Form Action callback`,
        location: action.location,
        trace: ["committed form", action.propName, "opaque Action callback"],
      });
    }
  }
  if (!owner) {
    unknownEvidence.push(
      createEvidence(unit.node, context.rootDirectory, "The Form Action owner cannot be resolved", [
        "React unit",
        "Form Action",
        "unknown owner",
      ]),
    );
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.FormActions,
      ReactObligationStatus.Violated,
      "A Form Action is attached to a control that cannot submit it",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.FormActions,
      ReactObligationStatus.Unknown,
      "Form Action callback identity or control semantics are incomplete",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.FormActions,
    ReactObligationStatus.Proved,
    "Every intrinsic Form Action resolves to a modeled Action execution root",
  );
};
