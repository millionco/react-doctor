import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactMemoComparatorStatus, ReactObligationStatus, ReactProofClaim } from "./types.js";
import { isMemoObservationCovered } from "./utils/is-memo-observation-covered.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeMemoEquivalence = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.MemoEquivalence,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify the component memoization contract",
    );
  }
  const comparators = context.graph.memoComparators.filter(
    (comparator) => comparator.ownerId === semanticUnit.id,
  );
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const comparator of comparators) {
    if (comparator.status === ReactMemoComparatorStatus.OmittedObservedProp) {
      for (const truePath of comparator.truePaths) {
        if (!truePath.sourceComplete) continue;
        for (const observation of comparator.observations) {
          if (
            !observation.valueCanVary ||
            isMemoObservationCovered(observation.path, truePath.equalPropPaths)
          ) {
            continue;
          }
          violations.push({
            description: `The comparator can skip a render while ${observation.path} changes`,
            location: observation.location,
            trace: [
              `observed prop ${observation.path}`,
              "custom memo comparator returns true",
              "stale component output or behavior",
            ],
          });
        }
      }
    } else if (!comparator.complete) {
      unknownEvidence.push({
        description:
          "The memoized component, observed prop paths, or comparator return paths are unresolved",
        location: comparator.comparatorLocation ?? comparator.location,
        trace: ["React.memo", "opaque component or comparator path", "unknown render equivalence"],
      });
    }
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.MemoEquivalence,
      ReactObligationStatus.Violated,
      "A custom memo comparator can suppress an observably different render",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.MemoEquivalence,
      ReactObligationStatus.Unknown,
      "Memo bailout equivalence could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.MemoEquivalence,
    ReactObligationStatus.Proved,
    comparators.length === 0
      ? "The component has no source-visible React memo bailout"
      : "Every modeled memo bailout preserves observed prop behavior",
  );
};
