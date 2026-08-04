import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactHookStateUpdaterStatus,
  ReactObligationStatus,
  ReactOptimisticActionStatus,
  ReactOptimisticReducerStatus,
  ReactProofClaim,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeOptimisticState = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const owner = findSemanticUnit(unit, context);
  const states = owner
    ? (context.graph?.optimisticStates.filter((state) => state.ownerId === owner.id) ?? [])
    : [];
  const updates = owner
    ? (context.graph?.optimisticUpdates.filter((update) => update.ownerId === owner.id) ?? [])
    : [];
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const state of states) {
    if (state.reducerStatus === ReactOptimisticReducerStatus.Impure) {
      violations.push({
        description: `${state.setterName} uses an impure optimistic reducer`,
        location: state.location,
        trace: ["useOptimistic", "reducer", "observable side effect"],
      });
    } else if (!state.complete) {
      unknownEvidence.push({
        description: `${state.setterName} has an unresolved optimistic reducer`,
        location: state.location,
        trace: ["useOptimistic", "reducer", state.reducerStatus],
      });
    }
  }
  for (const update of updates) {
    if (update.actionStatus === ReactOptimisticActionStatus.Render) {
      violations.push({
        description: "Optimistic state is updated during render",
        location: update.location,
        trace: ["render", "optimistic setter", "forbidden update"],
      });
    } else if (update.actionStatus === ReactOptimisticActionStatus.OutsideAction) {
      violations.push({
        description: "Optimistic state is updated outside a Transition or Form Action",
        location: update.location,
        trace: ["non-Action callback", "optimistic setter", "temporary state reverts"],
      });
    }
    if (update.updaterStatus === ReactHookStateUpdaterStatus.Impure) {
      violations.push({
        description: "An optimistic updater performs an observable side effect",
        location: update.location,
        trace: ["optimistic setter", "updater", "observable side effect"],
      });
    }
    if (
      !update.complete &&
      update.actionStatus !== ReactOptimisticActionStatus.Render &&
      update.actionStatus !== ReactOptimisticActionStatus.OutsideAction &&
      update.updaterStatus !== ReactHookStateUpdaterStatus.Impure
    ) {
      unknownEvidence.push({
        description:
          update.updaterStatus === ReactHookStateUpdaterStatus.SetterEscape
            ? "An optimistic setter escapes the modeled execution graph"
            : "An optimistic update has an unresolved Action origin or updater",
        location: update.location,
        trace: ["useOptimistic", update.actionStatus, update.updaterStatus],
      });
    }
  }
  if (!owner) {
    unknownEvidence.push(
      createEvidence(
        unit.node,
        context.rootDirectory,
        "The optimistic state owner cannot be resolved",
        ["React unit", "useOptimistic", "unknown owner"],
      ),
    );
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.OptimisticState,
      ReactObligationStatus.Violated,
      "An optimistic update violates Action ownership or updater purity",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.OptimisticState,
      ReactObligationStatus.Unknown,
      "Optimistic state ownership or purity is incomplete",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.OptimisticState,
    ReactObligationStatus.Proved,
    "Every optimistic reducer and updater is pure and every update runs inside an Action",
  );
};
