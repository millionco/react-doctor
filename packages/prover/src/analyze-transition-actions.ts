import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactObligationStatus, ReactProofClaim, ReactTransitionActionStatus } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactSemanticTransitionAction,
  ReactUnitDescriptor,
} from "./types.js";

const getIncompleteActionDescription = (action: ReactSemanticTransitionAction): string => {
  switch (action.status) {
    case ReactTransitionActionStatus.Async:
      return "An async Transition Action requires post-await ordering and nested transition proof";
    case ReactTransitionActionStatus.Opaque:
      return "A Transition Action callback cannot be resolved";
    case ReactTransitionActionStatus.StarterEscape:
      return "A Transition starter escapes the modeled execution graph";
    case ReactTransitionActionStatus.UnknownControl:
      return `Transition state may control an input through: ${action.unknownControlStateNames.join(", ")}`;
    default:
      return "A Transition Action has no valid execution root";
  }
};

export const analyzeTransitionActions = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const owner = findSemanticUnit(unit, context);
  const actions = owner
    ? (context.graph?.transitionActions.filter((action) => action.ownerId === owner.id) ?? [])
    : [];
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const action of actions) {
    if (action.status === ReactTransitionActionStatus.ControlledInput) {
      violations.push({
        description: `A Transition updates controlled input state: ${action.controlledStateNames.join(", ")}`,
        location: action.location,
        trace: ["Transition Action", "controlled input state", "non-urgent update"],
      });
    } else if (!action.complete) {
      unknownEvidence.push({
        description: getIncompleteActionDescription(action),
        location: action.location,
        trace: ["Transition Action", action.status, "incomplete lifecycle model"],
      });
    }
  }
  if (!owner) {
    unknownEvidence.push(
      createEvidence(
        unit.node,
        context.rootDirectory,
        "The Transition Action owner cannot be resolved",
        ["React unit", "Transition Action", "unknown owner"],
      ),
    );
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.TransitionActions,
      ReactObligationStatus.Violated,
      "A Transition performs an update that React requires to remain urgent",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.TransitionActions,
      ReactObligationStatus.Unknown,
      "Transition Action ownership or priority is incomplete",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.TransitionActions,
    ReactObligationStatus.Proved,
    "Every Transition Action has a synchronous source and a modeled execution owner",
  );
};
