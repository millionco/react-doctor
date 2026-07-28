import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactClassStateUpdaterStatus,
  ReactClassStateWriteStatus,
  ReactClassUpdateCycleStatus,
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

export const analyzeClassStateTransitions = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  if (unit.kind !== ReactUnitKind.ClassComponent) {
    return createObligation(
      ReactProofClaim.ClassStateTransitions,
      ReactObligationStatus.Proved,
      "The React unit has no class state transitions",
    );
  }
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (!context.graph || !semanticOwnerId) {
    return createObligation(
      ReactProofClaim.ClassStateTransitions,
      ReactObligationStatus.Unknown,
      "Class state transitions have no semantic owner",
    );
  }
  const lifecycle = context.graph.classLifecycles.find(
    (candidate) => candidate.ownerId === semanticOwnerId,
  );
  const transitions = context.graph.classStateTransitions.filter(
    (transition) => transition.ownerId === semanticOwnerId,
  );
  const stateWrites = context.graph.classStateWrites.filter(
    (stateWrite) => stateWrite.ownerId === semanticOwnerId,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const stateWrite of stateWrites) {
    const trace = [stateWrite.phase, "this.state", stateWrite.kind, stateWrite.status];
    if (stateWrite.status === ReactClassStateWriteStatus.Forbidden) {
      violations.push({
        description: "Class state is mutated directly outside construction",
        location: stateWrite.location,
        trace,
      });
    } else {
      unknownEvidence.push({
        description: "A class state reference escapes the modeled ownership boundary",
        location: stateWrite.location,
        trace,
      });
    }
  }
  for (const transition of transitions) {
    const trace = [
      transition.phase,
      "this.setState",
      transition.updaterStatus,
      transition.cycleStatus,
    ];
    if (transition.updaterStatus === ReactClassStateUpdaterStatus.Impure) {
      violations.push({
        description: "A setState updater performs an observable side effect",
        location: transition.location,
        trace,
      });
      continue;
    }
    if (transition.cycleStatus === ReactClassUpdateCycleStatus.Guaranteed) {
      violations.push({
        description: "An entry-dominating componentDidUpdate state write guarantees another update",
        location: transition.location,
        trace,
      });
      continue;
    }
    if (!transition.complete) {
      unknownEvidence.push({
        description:
          transition.cycleStatus === ReactClassUpdateCycleStatus.Unknown
            ? "The componentDidUpdate state transition has no proved convergence guard"
            : "The setState updater or commit callback is not completely modeled",
        location: transition.location,
        trace,
      });
    }
  }
  if (lifecycle && !lifecycle.sourceComplete) {
    unknownEvidence.push({
      description: "The class lifecycle contains an unmodeled state transition or method call",
      location: lifecycle.location,
      trace: ["class lifecycle", "unmodeled execution", "state transition completeness unknown"],
    });
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ClassStateTransitions,
      ReactObligationStatus.Violated,
      "Class state ownership, updater purity, or update convergence is violated",
      violations,
    );
  }
  if (!lifecycle?.sourceComplete || unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ClassStateTransitions,
      ReactObligationStatus.Unknown,
      "Class state ownership, transition purity, or convergence could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ClassStateTransitions,
    ReactObligationStatus.Proved,
    "Class state is React-owned, every updater is pure, and every update transition is bounded",
  );
};
