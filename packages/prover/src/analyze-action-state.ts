import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactActionStateDispatchStatus, ReactObligationStatus, ReactProofClaim } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeActionState = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const owner = findSemanticUnit(unit, context);
  const states = owner
    ? (context.graph?.actionStates.filter((state) => state.ownerId === owner.id) ?? [])
    : [];
  const dispatches = owner
    ? (context.graph?.actionStateDispatches.filter((dispatch) => dispatch.ownerId === owner.id) ??
      [])
    : [];
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const state of states) {
    if (!state.complete) {
      unknownEvidence.push({
        description: `${state.dispatcherName} has an unresolved reducer Action`,
        location: state.location,
        trace: ["useActionState", "reducer Action", state.reducerStatus],
      });
    }
  }
  for (const dispatch of dispatches) {
    if (dispatch.status === ReactActionStateDispatchStatus.Render) {
      violations.push({
        description: "Action state is dispatched during render",
        location: dispatch.location,
        trace: ["render", "Action State dispatcher", "forbidden update"],
      });
    } else if (dispatch.status === ReactActionStateDispatchStatus.OutsideAction) {
      violations.push({
        description: "Action state is dispatched outside an Action",
        location: dispatch.location,
        trace: ["non-Action callback", "Action State dispatcher", "missing Transition"],
      });
    } else if (!dispatch.complete) {
      unknownEvidence.push({
        description:
          dispatch.status === ReactActionStateDispatchStatus.SetterEscape
            ? "An Action State dispatcher escapes the modeled execution graph"
            : "An Action State dispatch has an unresolved Action origin",
        location: dispatch.location,
        trace: ["useActionState", dispatch.status, "incomplete Action ownership"],
      });
    }
  }
  if (!owner) {
    unknownEvidence.push(
      createEvidence(
        unit.node,
        context.rootDirectory,
        "The Action State owner cannot be resolved",
        ["React unit", "useActionState", "unknown owner"],
      ),
    );
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ActionState,
      ReactObligationStatus.Violated,
      "An Action State dispatcher is invoked outside an Action",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ActionState,
      ReactObligationStatus.Unknown,
      "Action State reducer identity or dispatcher ownership is incomplete",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ActionState,
    ReactObligationStatus.Proved,
    "Every Action State reducer is source-resolved and every dispatcher runs inside an Action",
  );
};
