import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactHostControlStatus,
  ReactHostControlUpdateStatus,
  ReactHostControlValueStatus,
  ReactObligationStatus,
  ReactProofClaim,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeHostControl = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.HostControl,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify host control protocols",
    );
  }
  const controls = context.graph.hostControls.filter(
    (control) => control.ownerId === semanticUnit.id,
  );
  const violatedEvidence: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const control of controls) {
    if (control.controlledPropPresent && control.defaultPropPresent) {
      violatedEvidence.push({
        description: `The host control receives both ${control.controlledPropName} and ${control.defaultPropName}`,
        location: control.location,
        trace: ["intrinsic form control", "controlled and default props", "conflicting ownership"],
      });
    }
    if (control.valueStatus === ReactHostControlValueStatus.MaySwitch) {
      violatedEvidence.push({
        description: "The host control can switch between controlled and uncontrolled values",
        location: control.location,
        trace: ["React state", "defined and nullish values", "unstable control ownership"],
      });
    } else if (control.valueStatus === ReactHostControlValueStatus.Nullish) {
      violatedEvidence.push({
        description: `The host control passes a nullish ${control.controlledPropName} prop`,
        location: control.location,
        trace: ["intrinsic form control", "nullish controlled prop", "invalid React value"],
      });
    }
    if (control.updateStatus === ReactHostControlUpdateStatus.Missing) {
      violatedEvidence.push({
        description: `An editable controlled field has no synchronous ${control.controlledPropName} update`,
        location: control.location,
        trace: ["onChange", "missing backing-state write", "read-only or reverted field"],
      });
    } else if (control.updateStatus === ReactHostControlUpdateStatus.Conditional) {
      violatedEvidence.push({
        description: "A controlled field updates its backing state only on some change paths",
        location: control.location,
        trace: ["onChange", "conditional state write", "stale controlled value"],
      });
    } else if (control.updateStatus === ReactHostControlUpdateStatus.Deferred) {
      violatedEvidence.push({
        description: "A controlled field defers its backing-state update",
        location: control.location,
        trace: ["onChange", "deferred state write", "React reverts the DOM value"],
      });
    } else if (control.updateStatus === ReactHostControlUpdateStatus.WrongValue) {
      violatedEvidence.push({
        description: "A controlled field does not synchronously echo the changed DOM value",
        location: control.location,
        trace: ["onChange", "different backing-state value", "selection or caret instability"],
      });
    }
    if (control.status === ReactHostControlStatus.Unknown) {
      unknownEvidence.push({
        description: "The host control crosses an opaque value, prop, or callback boundary",
        location: control.location,
        trace: ["intrinsic form control", "unresolved protocol", "unknown control ownership"],
      });
    }
  }
  if (violatedEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.HostControl,
      ReactObligationStatus.Violated,
      "A host control violates React controlled-value requirements",
      violatedEvidence,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.HostControl,
      ReactObligationStatus.Unknown,
      "A host control protocol is incomplete",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.HostControl,
    ReactObligationStatus.Proved,
    controls.length > 0
      ? "Every intrinsic form control has stable ownership and a valid update protocol"
      : "The unit renders no intrinsic form controls",
  );
};
