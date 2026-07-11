import { compareListenerCallbackIdentities } from "./compare-listener-callback-identities.js";
import { compareListenerTargetKeys } from "./compare-listener-target-keys.js";
import { doesListenerAnalysisAbortController } from "./does-listener-analysis-abort-controller.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

interface CallbackIdentity {
  readonly node: EsTreeNode;
  readonly isConcreteFunction: boolean;
}

interface ListenerCandidate {
  readonly targetKey: string;
  readonly eventName: string;
  readonly callbackIdentity: CallbackIdentity | null;
  readonly capture: boolean | null;
}

interface CancellationAnalysis {
  readonly removals: ReadonlyArray<ListenerCandidate>;
  readonly abortedControllerSymbolIds: ReadonlySet<number>;
  readonly exhaustiveBranches: ReadonlyArray<ExhaustiveCleanupBranches>;
  readonly hasUnknownAbortCall: boolean;
  readonly hasUnknownRemovalCall: boolean;
}

interface ExhaustiveCleanupBranches {
  readonly alternate: CancellationAnalysis;
  readonly consequent: CancellationAnalysis;
}

interface ListenerRegistration {
  readonly targetKey: string;
  readonly eventName: string;
  readonly callbackIdentity: CallbackIdentity;
  readonly capture: boolean;
  readonly abortControllerSymbolId: number | null;
}

const cancellationResult = (
  analysis: CancellationAnalysis,
  registration: ListenerRegistration,
): "cancelled" | "not-cancelled" | "unknown" => {
  if (
    registration.abortControllerSymbolId !== null &&
    doesListenerAnalysisAbortController(analysis, registration.abortControllerSymbolId)
  ) {
    return "cancelled";
  }
  let result: "not-cancelled" | "unknown" =
    analysis.hasUnknownRemovalCall ||
    (registration.abortControllerSymbolId !== null && analysis.hasUnknownAbortCall)
      ? "unknown"
      : "not-cancelled";
  for (const removal of analysis.removals) {
    if (
      removal.eventName !== registration.eventName ||
      removal.capture !== registration.capture ||
      removal.callbackIdentity === null ||
      compareListenerCallbackIdentities(registration.callbackIdentity, removal.callbackIdentity) !==
        "same"
    ) {
      continue;
    }
    const targetComparison = compareListenerTargetKeys(registration.targetKey, removal.targetKey);
    if (targetComparison === "same") return "cancelled";
    if (targetComparison === "unknown") result = "unknown";
  }
  for (const { alternate, consequent } of analysis.exhaustiveBranches) {
    const alternateResult = cancellationResult(alternate, registration);
    const consequentResult = cancellationResult(consequent, registration);
    if (alternateResult === "cancelled" && consequentResult === "cancelled") {
      return "cancelled";
    }
    if (alternateResult !== "not-cancelled" && consequentResult !== "not-cancelled") {
      result = "unknown";
    }
  }
  return result;
};

export const doesListenerAnalysisCancelRegistration = (
  analysis: CancellationAnalysis,
  registration: ListenerRegistration,
): boolean => cancellationResult(analysis, registration) !== "not-cancelled";
