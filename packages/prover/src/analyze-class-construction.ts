import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactClassConstructionIssueKind,
  ReactClassConstructionIssueStatus,
  ReactClassConstructionStatus,
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

const getIssueDescription = (issueKind: ReactClassConstructionIssueKind): string => {
  if (issueKind === ReactClassConstructionIssueKind.InvalidStateValue) {
    return "Class state is initialized with a value that is not an object";
  }
  if (issueKind === ReactClassConstructionIssueKind.InvalidSuperCall) {
    return "The constructor does not call super with its props before every other statement";
  }
  if (issueKind === ReactClassConstructionIssueKind.MissingStateInitialization) {
    return "The class reads state without a proved initialization";
  }
  if (issueKind === ReactClassConstructionIssueKind.MultipleStateInitializations) {
    return "Multiple class state initialization paths require an ordering proof";
  }
  if (issueKind === ReactClassConstructionIssueKind.SetStateCall) {
    return "The constructor calls setState instead of initializing state directly";
  }
  if (issueKind === ReactClassConstructionIssueKind.SideEffect) {
    return "Class construction contains an observable or non-idempotent operation";
  }
  if (issueKind === ReactClassConstructionIssueKind.UnsupportedConstructorStatement) {
    return "A constructor statement has no construction proof";
  }
  return "A class field initializer contains an expression with no purity proof";
};

export const analyzeClassConstruction = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  if (unit.kind !== ReactUnitKind.ClassComponent) {
    return createObligation(
      ReactProofClaim.ClassConstruction,
      ReactObligationStatus.Proved,
      "Function units have no class construction phase",
    );
  }
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  const construction = context.graph?.classConstructions.find(
    (candidate) => candidate.ownerId === semanticOwnerId,
  );
  if (!construction) {
    return createObligation(
      ReactProofClaim.ClassConstruction,
      ReactObligationStatus.Unknown,
      "Class construction has no semantic certificate",
    );
  }
  const violatedEvidence: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const issue of construction.issues) {
    const evidence = {
      description: getIssueDescription(issue.kind),
      location: issue.location,
      trace: [
        "class construction",
        issue.kind,
        issue.status === ReactClassConstructionIssueStatus.Violated
          ? "React construction invariant violated"
          : "construction proof incomplete",
      ],
    };
    if (issue.status === ReactClassConstructionIssueStatus.Violated) {
      violatedEvidence.push(evidence);
    } else {
      unknownEvidence.push(evidence);
    }
  }
  if (construction.status === ReactClassConstructionStatus.Invalid || violatedEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ClassConstruction,
      ReactObligationStatus.Violated,
      "Class construction violates initialization, purity, or superclass ordering",
      violatedEvidence,
    );
  }
  if (construction.status === ReactClassConstructionStatus.Unknown || unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ClassConstruction,
      ReactObligationStatus.Unknown,
      "Class construction purity or state initialization could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ClassConstruction,
    ReactObligationStatus.Proved,
    "Class construction is pure, ordered, and initializes required state",
  );
};
