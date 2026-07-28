import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofObligation, ReactUnitDescriptor } from "./types.js";

export const analyzeReactNodeFlow = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.ReactNodeFlow,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify this ReactNode source",
      [],
    );
  }
  const slotFlows = context.graph.slotFlows.filter(
    (slotFlow) => slotFlow.ownerId === semanticUnit.id,
  );
  const incompleteSlotFlows = slotFlows.filter((slotFlow) => !slotFlow.complete);
  if (incompleteSlotFlows.length > 0) {
    return createObligation(
      ReactProofClaim.ReactNodeFlow,
      ReactObligationStatus.Unknown,
      "A ReactNode slot crosses an unresolved render boundary",
      incompleteSlotFlows.map((slotFlow) => ({
        description: slotFlow.sourceComplete
          ? "The ReactNode value has no complete project-local placement path"
          : "The ReactNode value reaches its slot through an unresolved source expression",
        location: slotFlow.location,
        trace: [
          slotFlow.propName ? `${slotFlow.propName} ReactNode` : "ReactNode value",
          slotFlow.sourceComplete ? "closed source expression" : "unknown source expression",
          slotFlow.placementComplete ? "closed component slot" : "unknown component slot",
        ],
      })),
    );
  }
  return createObligation(
    ReactProofClaim.ReactNodeFlow,
    ReactObligationStatus.Proved,
    slotFlows.length > 0
      ? "Every ReactNode value has a closed project-local slot path"
      : "The unit has no component ReactNode slot input",
    [],
  );
};
