import { analyzeActionState } from "./analyze-action-state.js";
import { analyzeAsyncEffectOwnership } from "./analyze-async-effect-ownership.js";
import { analyzeBoundaryCoverage } from "./analyze-boundary-coverage.js";
import { analyzeCallableRefFreshness } from "./analyze-callable-ref-freshness.js";
import { analyzeClassConstruction } from "./analyze-class-construction.js";
import { analyzeClassStateTransitions } from "./analyze-class-state-transitions.js";
import { analyzeComponentIdentity } from "./analyze-component-identity.js";
import { analyzeComponentInvocation } from "./analyze-component-invocation.js";
import { analyzeContextTopology } from "./analyze-context-topology.js";
import { analyzeEffectCleanup } from "./analyze-effect-cleanup.js";
import { analyzeEffectDependencies } from "./analyze-effect-dependencies.js";
import { analyzeEffectEventUsage } from "./analyze-effect-event-usage.js";
import { analyzeEffectStateUpdates } from "./analyze-effect-state-updates.js";
import { analyzeExternalStoreConsistency } from "./analyze-external-store-consistency.js";
import { analyzeFormActions } from "./analyze-form-actions.js";
import { analyzeFormStatus } from "./analyze-form-status.js";
import { analyzeHookOrder } from "./analyze-hook-order.js";
import { analyzeHookOwnership } from "./analyze-hook-ownership.js";
import { analyzeHookStateTransitions } from "./analyze-hook-state-transitions.js";
import { analyzeImperativeHandle } from "./analyze-imperative-handle.js";
import { analyzeMemoDependencies } from "./analyze-memo-dependencies.js";
import { analyzeOptimisticState } from "./analyze-optimistic-state.js";
import { analyzeRefAccess } from "./analyze-ref-access.js";
import { analyzeReactNodeFlow } from "./analyze-react-node-flow.js";
import { analyzeReducerPurity } from "./analyze-reducer-purity.js";
import { analyzeReducerTransitions } from "./analyze-reducer-transitions.js";
import { analyzeReconciliationIdentity } from "./analyze-reconciliation-identity.js";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
import { analyzeScheduledCallbackLifetime } from "./analyze-scheduled-callback-lifetime.js";
import { analyzeTransitionActions } from "./analyze-transition-actions.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getNodeLocation } from "./get-node-location.js";
import { ReactObligationStatus, ReactProofClaim, ReactUnitKind } from "./types.js";
import type { ReactAnalysisContext, ReactUnitDescriptor, ReactUnitProof } from "./types.js";

const ALL_REACT_PROOF_CLAIMS: ReadonlyArray<ReactProofClaim> = [
  ReactProofClaim.ActionState,
  ReactProofClaim.AsyncEffectOwnership,
  ReactProofClaim.BoundaryCoverage,
  ReactProofClaim.CallableRefFreshness,
  ReactProofClaim.ClassConstruction,
  ReactProofClaim.ClassStateTransitions,
  ReactProofClaim.ComponentIdentity,
  ReactProofClaim.ComponentInvocation,
  ReactProofClaim.ContextTopology,
  ReactProofClaim.EffectCleanup,
  ReactProofClaim.EffectDependencies,
  ReactProofClaim.EffectEventUsage,
  ReactProofClaim.EffectStateUpdates,
  ReactProofClaim.ExternalStoreConsistency,
  ReactProofClaim.FormActions,
  ReactProofClaim.FormStatus,
  ReactProofClaim.HookOrder,
  ReactProofClaim.HookOwnership,
  ReactProofClaim.HookStateTransitions,
  ReactProofClaim.ImperativeHandle,
  ReactProofClaim.MemoDependencies,
  ReactProofClaim.OptimisticState,
  ReactProofClaim.ReactNodeFlow,
  ReactProofClaim.ReconciliationIdentity,
  ReactProofClaim.ReducerPurity,
  ReactProofClaim.ReducerTransitions,
  ReactProofClaim.RefAccess,
  ReactProofClaim.RenderPurity,
  ReactProofClaim.ScheduledCallbackLifetime,
  ReactProofClaim.TransitionActions,
];

export const analyzeReactUnit = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactUnitProof => {
  if (unit.kind === ReactUnitKind.InvalidHookOwner) {
    const hookEvidence = (unit.invalidHookCalls ?? []).map((hookCall) =>
      createEvidence(
        hookCall,
        context.rootDirectory,
        `${hookCall.expression.getText()} is called outside a component or custom hook`,
        ["React hook", "invalid function or module owner", "hook state has no valid owner"],
      ),
    );
    return {
      name: unit.name,
      kind: unit.kind,
      location: getNodeLocation(unit.node, context.rootDirectory),
      obligations: ALL_REACT_PROOF_CLAIMS.map((claim) =>
        claim === ReactProofClaim.HookOwnership
          ? createObligation(
              claim,
              ReactObligationStatus.Violated,
              "A hook call has no valid React owner",
              hookEvidence,
            )
          : createObligation(
              claim,
              ReactObligationStatus.Unknown,
              "The invalid hook owner prevents this proof",
              hookEvidence,
            ),
      ),
    };
  }
  if (!unit.functionNode || !unit.sourceComplete) {
    const evidence = [
      createEvidence(
        unit.node,
        context.rootDirectory,
        unit.kind === ReactUnitKind.ClassComponent
          ? "The class contains constructor, field, lifecycle, ref, or custom method semantics that are not modeled yet"
          : "The React unit has no analyzable execution root",
        [
          unit.kind === ReactUnitKind.ClassComponent ? "class component" : "React unit",
          "unmodeled execution surface",
          "unsupported proof model",
        ],
      ),
    ];
    return {
      name: unit.name,
      kind: unit.kind,
      location: getNodeLocation(unit.node, context.rootDirectory),
      obligations: ALL_REACT_PROOF_CLAIMS.map((claim) =>
        createObligation(
          claim,
          ReactObligationStatus.Unknown,
          unit.kind === ReactUnitKind.ClassComponent
            ? "Class component execution coverage is incomplete"
            : "React unit proof is incomplete",
          evidence,
        ),
      ),
    };
  }

  return {
    name: unit.name,
    kind: unit.kind,
    location: getNodeLocation(unit.node, context.rootDirectory),
    obligations: [
      analyzeActionState(unit, context),
      analyzeAsyncEffectOwnership(unit.functionNode, context),
      analyzeBoundaryCoverage(unit, context),
      analyzeCallableRefFreshness(unit, context),
      analyzeClassConstruction(unit, context),
      analyzeClassStateTransitions(unit, context),
      analyzeComponentIdentity(unit.functionNode, context),
      analyzeComponentInvocation(unit.functionNode, context),
      analyzeContextTopology(unit, context),
      analyzeEffectCleanup(unit, context),
      analyzeEffectDependencies(unit.functionNode, context),
      analyzeEffectEventUsage(unit.functionNode, context),
      analyzeEffectStateUpdates(unit, context),
      analyzeExternalStoreConsistency(unit, context),
      analyzeFormActions(unit, context),
      analyzeFormStatus(unit, context),
      analyzeHookOrder(unit.functionNode, context),
      analyzeHookOwnership(unit.functionNode),
      analyzeHookStateTransitions(unit, context),
      analyzeImperativeHandle(unit, context),
      analyzeMemoDependencies(unit.functionNode, context),
      analyzeOptimisticState(unit, context),
      analyzeReactNodeFlow(unit, context),
      analyzeReconciliationIdentity(unit.functionNode, context),
      analyzeReducerPurity(unit.functionNode, context),
      analyzeReducerTransitions(unit, context),
      analyzeRefAccess(unit.functionNode, context),
      analyzeRenderPurity(unit.functionNode, context),
      analyzeScheduledCallbackLifetime(unit, context),
      analyzeTransitionActions(unit, context),
    ],
  };
};
