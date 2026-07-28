import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactHookStateUpdaterStatus,
  ReactObligationStatus,
  ReactProofClaim,
  ReactUnitKind,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeHookStateTransitions = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  if (unit.kind === ReactUnitKind.ClassComponent) {
    return createObligation(
      ReactProofClaim.HookStateTransitions,
      ReactObligationStatus.Proved,
      "The class component has no Hook state transitions",
    );
  }
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (!context.graph || !semanticOwnerId) {
    return createObligation(
      ReactProofClaim.HookStateTransitions,
      ReactObligationStatus.Unknown,
      "Hook state transitions have no semantic owner",
    );
  }
  const transitions = context.graph.hookStateTransitions.filter(
    (transition) => transition.ownerId === semanticOwnerId,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const transition of transitions) {
    const trace = [
      transition.setterName,
      transition.updaterStatus,
      transition.sourceComplete ? "modeled callback root" : "unmodeled callback root",
    ];
    if (transition.updaterStatus === ReactHookStateUpdaterStatus.Impure) {
      violations.push({
        description: `${transition.setterName} receives an updater with an observable side effect`,
        location: transition.location,
        trace,
      });
    } else if (!transition.complete) {
      let description = `${transition.setterName} executes outside a proved React callback root`;
      if (transition.updaterStatus === ReactHookStateUpdaterStatus.SetterEscape) {
        description = `${transition.setterName} escapes the modeled React callback graph`;
      } else if (transition.updaterStatus === ReactHookStateUpdaterStatus.Unknown) {
        description = `${transition.setterName} receives an updater without a proved body`;
      }
      unknownEvidence.push({
        description,
        location: transition.location,
        trace,
      });
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.HookStateTransitions,
      ReactObligationStatus.Violated,
      "A Hook state updater is impure",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.HookStateTransitions,
      ReactObligationStatus.Unknown,
      "Hook state transition purity or callback ownership could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.HookStateTransitions,
    ReactObligationStatus.Proved,
    "Every represented Hook state transition has a proved callback root and pure updater",
  );
};
