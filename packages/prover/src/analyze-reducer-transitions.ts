import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactObligationStatus,
  ReactProofClaim,
  ReactReducerDispatchStatus,
  ReactReducerPurityStatus,
  ReactReducerReturnStatus,
  ReactUnitKind,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeReducerTransitions = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  if (unit.kind === ReactUnitKind.ClassComponent) {
    return createObligation(
      ReactProofClaim.ReducerTransitions,
      ReactObligationStatus.Proved,
      "The class component has no reducer transition protocol",
    );
  }
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  if (!context.graph || !semanticOwnerId) {
    return createObligation(
      ReactProofClaim.ReducerTransitions,
      ReactObligationStatus.Unknown,
      "Reducer transitions have no semantic owner",
    );
  }
  const reducers = context.graph.reducers.filter((reducer) => reducer.ownerId === semanticOwnerId);
  const dispatches = context.graph.reducerDispatches.filter(
    (dispatch) => dispatch.ownerId === semanticOwnerId,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const reducer of reducers) {
    if (
      reducer.reducerPurity === ReactReducerPurityStatus.Impure ||
      reducer.initializerPurity === ReactReducerPurityStatus.Impure
    ) {
      violations.push({
        description: `${reducer.dispatcherName} has an impure reducer or initializer`,
        location: reducer.location,
        trace: ["useReducer", reducer.dispatcherName, "impure state transition"],
      });
    }
    if (
      reducer.reducerReturnStatus === ReactReducerReturnStatus.MayFallThrough ||
      reducer.initializerReturnStatus === ReactReducerReturnStatus.MayFallThrough
    ) {
      violations.push({
        description: `${reducer.dispatcherName} can complete without returning state`,
        location: reducer.location,
        trace: ["useReducer", reducer.dispatcherName, "fallthrough path"],
      });
    }
    if (
      reducer.reducerReturnStatus === ReactReducerReturnStatus.MayThrow ||
      reducer.initializerReturnStatus === ReactReducerReturnStatus.MayThrow
    ) {
      violations.push({
        description: `${reducer.dispatcherName} can throw instead of returning state`,
        location: reducer.location,
        trace: ["useReducer", reducer.dispatcherName, "throw path"],
      });
    }
    if (!reducer.sourceComplete) {
      unknownEvidence.push({
        description: `${reducer.dispatcherName} depends on an opaque reducer, initializer, or control-flow path`,
        location: reducer.location,
        trace: ["useReducer", reducer.dispatcherName, "incomplete transition definition"],
      });
    }
  }
  for (const dispatch of dispatches) {
    if (
      dispatch.status === ReactReducerDispatchStatus.Render ||
      dispatch.status === ReactReducerDispatchStatus.Reducer
    ) {
      violations.push({
        description:
          dispatch.status === ReactReducerDispatchStatus.Render
            ? "A reducer dispatch executes during render"
            : "A reducer dispatch executes from a reducer transition",
        location: dispatch.location,
        trace: ["useReducer dispatch", dispatch.status, "nested render update"],
      });
    } else if (!dispatch.complete) {
      unknownEvidence.push({
        description:
          dispatch.status === ReactReducerDispatchStatus.Escape
            ? "A reducer dispatcher escapes the modeled React callback graph"
            : "A reducer dispatch has no proved React callback owner",
        location: dispatch.location,
        trace: ["useReducer dispatch", dispatch.status, "incomplete execution ownership"],
      });
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ReducerTransitions,
      ReactObligationStatus.Violated,
      "A reducer transition is impure, non-total, or executes from an invalid phase",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ReducerTransitions,
      ReactObligationStatus.Unknown,
      "Reducer transition totality or dispatch ownership could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ReducerTransitions,
    ReactObligationStatus.Proved,
    "Every reducer transition is pure and total with owned non-render dispatches",
  );
};
