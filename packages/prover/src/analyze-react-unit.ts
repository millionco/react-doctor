import { analyzeAsyncEffectOwnership } from "./analyze-async-effect-ownership.js";
import { analyzeBoundaryCoverage } from "./analyze-boundary-coverage.js";
import { analyzeCallableRefFreshness } from "./analyze-callable-ref-freshness.js";
import { analyzeComponentIdentity } from "./analyze-component-identity.js";
import { analyzeComponentInvocation } from "./analyze-component-invocation.js";
import { analyzeContextTopology } from "./analyze-context-topology.js";
import { analyzeEffectCleanup } from "./analyze-effect-cleanup.js";
import { analyzeEffectDependencies } from "./analyze-effect-dependencies.js";
import { analyzeEffectEventUsage } from "./analyze-effect-event-usage.js";
import { analyzeEffectStateUpdates } from "./analyze-effect-state-updates.js";
import { analyzeExternalStoreConsistency } from "./analyze-external-store-consistency.js";
import { analyzeHookOrder } from "./analyze-hook-order.js";
import { analyzeHookOwnership } from "./analyze-hook-ownership.js";
import { analyzeMemoDependencies } from "./analyze-memo-dependencies.js";
import { analyzeRefAccess } from "./analyze-ref-access.js";
import { analyzeReducerPurity } from "./analyze-reducer-purity.js";
import { analyzeReconciliationIdentity } from "./analyze-reconciliation-identity.js";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getNodeLocation } from "./get-node-location.js";
import { ReactObligationStatus, ReactProofClaim, ReactUnitKind } from "./types.js";
import type { ReactAnalysisContext, ReactUnitDescriptor, ReactUnitProof } from "./types.js";

const ALL_REACT_PROOF_CLAIMS: ReadonlyArray<ReactProofClaim> = [
  ReactProofClaim.AsyncEffectOwnership,
  ReactProofClaim.BoundaryCoverage,
  ReactProofClaim.CallableRefFreshness,
  ReactProofClaim.ComponentIdentity,
  ReactProofClaim.ComponentInvocation,
  ReactProofClaim.ContextTopology,
  ReactProofClaim.EffectCleanup,
  ReactProofClaim.EffectDependencies,
  ReactProofClaim.EffectEventUsage,
  ReactProofClaim.EffectStateUpdates,
  ReactProofClaim.ExternalStoreConsistency,
  ReactProofClaim.HookOrder,
  ReactProofClaim.HookOwnership,
  ReactProofClaim.MemoDependencies,
  ReactProofClaim.ReconciliationIdentity,
  ReactProofClaim.ReducerPurity,
  ReactProofClaim.RefAccess,
  ReactProofClaim.RenderPurity,
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
  if (unit.kind === ReactUnitKind.ClassComponent || !unit.functionNode) {
    const evidence = [
      createEvidence(
        unit.node,
        context.rootDirectory,
        "Class component lifecycle semantics are not modeled yet",
        ["class component", "React lifecycle", "unsupported proof model"],
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
          "Class component proof is incomplete",
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
      analyzeAsyncEffectOwnership(unit.functionNode, context),
      analyzeBoundaryCoverage(unit, context),
      analyzeCallableRefFreshness(unit, context),
      analyzeComponentIdentity(unit.functionNode, context),
      analyzeComponentInvocation(unit.functionNode, context),
      analyzeContextTopology(unit, context),
      analyzeEffectCleanup(unit.functionNode, context),
      analyzeEffectDependencies(unit.functionNode, context),
      analyzeEffectEventUsage(unit.functionNode, context),
      analyzeEffectStateUpdates(unit, context),
      analyzeExternalStoreConsistency(unit, context),
      analyzeHookOrder(unit.functionNode, context),
      analyzeHookOwnership(unit.functionNode),
      analyzeMemoDependencies(unit.functionNode, context),
      analyzeReconciliationIdentity(unit.functionNode, context),
      analyzeReducerPurity(unit.functionNode, context),
      analyzeRefAccess(unit.functionNode, context),
      analyzeRenderPurity(unit.functionNode, context),
    ],
  };
};
