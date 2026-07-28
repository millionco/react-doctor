import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactFormStatusTopologyStatus, ReactObligationStatus, ReactProofClaim } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofLocation,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

const createGraphEvidence = (
  location: ReactProofLocation,
  description: string,
  trace: ReadonlyArray<string>,
): ReactProofEvidence => ({ description, location, trace });

export const analyzeFormStatus = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.FormStatus,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify this Form Status owner",
      [],
    );
  }

  const formStatuses = context.graph.formStatuses.filter(
    (formStatus) => formStatus.ownerId === semanticUnit.id,
  );
  const outsideFormStatuses = formStatuses.filter(
    (formStatus) => formStatus.status === ReactFormStatusTopologyStatus.OutsideForm,
  );
  if (outsideFormStatuses.length > 0) {
    return createObligation(
      ReactProofClaim.FormStatus,
      ReactObligationStatus.Violated,
      "A Form Status consumer can render without a parent form",
      outsideFormStatuses.map((formStatus) =>
        createGraphEvidence(
          formStatus.location,
          "useFormStatus can render without a parent <form>",
          [
            "useFormStatus",
            "closed render path outside a parent form",
            "pending status never becomes active",
          ],
        ),
      ),
    );
  }

  const unresolvedFormStatuses = formStatuses.filter(
    (formStatus) =>
      formStatus.status === ReactFormStatusTopologyStatus.Unknown || !formStatus.complete,
  );
  if (unresolvedFormStatuses.length > 0) {
    return createObligation(
      ReactProofClaim.FormStatus,
      ReactObligationStatus.Unknown,
      "A Form Status consumer has unresolved parent-form topology",
      unresolvedFormStatuses.map((formStatus) =>
        createGraphEvidence(
          formStatus.location,
          "The nearest parent <form> cannot be resolved on every render path",
          ["useFormStatus", "component render topology", "unknown parent form"],
        ),
      ),
    );
  }

  return createObligation(
    ReactProofClaim.FormStatus,
    ReactObligationStatus.Proved,
    formStatuses.length > 0
      ? "Every Form Status consumer resolves to a parent form on every render path"
      : "The unit has no Form Status consumer",
    [],
  );
};
