import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  checkReactProofReport,
  proveReactApp,
  ReactAppProofStatus,
  ReactAsyncOwnershipStatus,
  ReactCallableRefFreshness,
  ReactClassComponentBase,
  ReactClassStateUpdaterStatus,
  ReactClassStateWriteKind,
  ReactClassStateWriteStatus,
  ReactClassUpdateCycleStatus,
  ReactCompilerFactStatus,
  ReactEffectDependencyMode,
  ReactEffectResourceDisposalStatus,
  ReactEffectResourceKind,
  ReactExecutionPhase,
  ReactIdentityStability,
  ReactObligationStatus,
  ReactProofClaim,
  ReactSchedulerCancellationStatus,
  ReactSchedulerKind,
  ReactProofCertificateStatus,
  ReactSemanticEdgeKind,
  ReactSemanticCallbackKind,
  ReactSemanticFunctionCallKind,
} from "../src/index.js";

interface RefutedFixtureExpectation {
  fixtureName: string;
  claim: ReactProofClaim;
  evidencePattern: RegExp;
}

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const proveFixture = (fixtureName: string) =>
  proveReactApp({
    rootDirectory: path.join(fixturesDirectory, fixtureName),
  });

const REFUTED_FIXTURES: ReadonlyArray<RefutedFixtureExpectation> = [
  {
    fixtureName: "class-direct-state-mutation",
    claim: ReactProofClaim.ClassStateTransitions,
    evidencePattern: /mutated directly outside construction/,
  },
  {
    fixtureName: "class-state-mutating-call",
    claim: ReactProofClaim.ClassStateTransitions,
    evidencePattern: /mutated directly outside construction/,
  },
  {
    fixtureName: "class-unmount-state-mutation",
    claim: ReactProofClaim.ClassStateTransitions,
    evidencePattern: /mutated directly outside construction/,
  },
  {
    fixtureName: "class-update-loop",
    claim: ReactProofClaim.ClassStateTransitions,
    evidencePattern: /guarantees another update/,
  },
  {
    fixtureName: "class-impure-state-updater",
    claim: ReactProofClaim.ClassStateTransitions,
    evidencePattern: /observable side effect/,
  },
  {
    fixtureName: "conditional-hook",
    claim: ReactProofClaim.HookOrder,
    evidencePattern: /invariant hook position/,
  },
  {
    fixtureName: "stale-effect",
    claim: ReactProofClaim.EffectDependencies,
    evidencePattern: /absent from the effect dependency list/,
  },
  {
    fixtureName: "refuted-layout-ref-missing-dependency",
    claim: ReactProofClaim.EffectDependencies,
    evidencePattern: /absent from the effect dependency list/,
  },
  {
    fixtureName: "refuted-timer-partial-cleanup",
    claim: ReactProofClaim.ScheduledCallbackLifetime,
    evidencePattern: /remain active/,
  },
  {
    fixtureName: "impure-render",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "cleanup-mismatch",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "quoted-capture-cleanup-mismatch",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "mutation-observer-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "abort-signal-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "listener-partial-cleanup",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "listener-conditional-disposal",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "mixed-opaque-effect-and-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "class-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "class-listener-capture-mismatch",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "class-timeout-leak",
    claim: ReactProofClaim.ScheduledCallbackLifetime,
    evidencePattern: /remain active after its lifecycle loses ownership/,
  },
  {
    fixtureName: "nested-component",
    claim: ReactProofClaim.ComponentIdentity,
    evidencePattern: /recreated as a component type/,
  },
  {
    fixtureName: "direct-component-call",
    claim: ReactProofClaim.ComponentInvocation,
    evidencePattern: /called as a regular function/,
  },
  {
    fixtureName: "render-ref-access",
    claim: ReactProofClaim.RefAccess,
    evidencePattern: /accessed during render/,
  },
  {
    fixtureName: "coreui-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /same resource identity/,
  },
  {
    fixtureName: "state-update-in-render",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /updates state during render/,
  },
  {
    fixtureName: "prop-mutation",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /mutates an input during render/,
  },
  {
    fixtureName: "helper-aliased-prop-mutation",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /mutated during render/,
  },
  {
    fixtureName: "transitive-impure-helper",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "render-callback-parameter-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "render-returned-callback-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "timer-leak",
    claim: ReactProofClaim.ScheduledCallbackLifetime,
    evidencePattern: /remain active/,
  },
  {
    fixtureName: "invalid-hook-helper",
    claim: ReactProofClaim.HookOwnership,
    evidencePattern: /outside a component or custom hook/,
  },
  {
    fixtureName: "module-hook-call",
    claim: ReactProofClaim.HookOwnership,
    evidencePattern: /outside a component or custom hook/,
  },
  {
    fixtureName: "anonymous-hook-callback",
    claim: ReactProofClaim.HookOwnership,
    evidencePattern: /outside a component or custom hook/,
  },
  {
    fixtureName: "memo-callback",
    claim: ReactProofClaim.MemoDependencies,
    evidencePattern: /absent from the useCallback dependency list/,
  },
  {
    fixtureName: "impure-reducer",
    claim: ReactProofClaim.ReducerPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "named-memo-impure-helper",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "aliased-stale-effect",
    claim: ReactProofClaim.EffectDependencies,
    evidencePattern: /absent from the effect dependency list/,
  },
  {
    fixtureName: "use-in-try",
    claim: ReactProofClaim.HookOrder,
    evidencePattern: /cannot be called from a try or catch block/,
  },
  {
    fixtureName: "missing-list-key",
    claim: ReactProofClaim.ReconciliationIdentity,
    evidencePattern: /no reconciliation key/,
  },
  {
    fixtureName: "duplicate-list-key",
    claim: ReactProofClaim.ReconciliationIdentity,
    evidencePattern: /duplicated/,
  },
  {
    fixtureName: "effect-self-cycle",
    claim: ReactProofClaim.EffectStateUpdates,
    evidencePattern: /necessarily changes a dependency/,
  },
  {
    fixtureName: "fresh-external-store-snapshot",
    claim: ReactProofClaim.ExternalStoreConsistency,
    evidencePattern: /fresh or missing value/,
  },
  {
    fixtureName: "silent-external-store-write",
    claim: ReactProofClaim.ExternalStoreConsistency,
    evidencePattern: /without notifying/,
  },
  {
    fixtureName: "mismatched-server-snapshot",
    claim: ReactProofClaim.ExternalStoreConsistency,
    evidencePattern: /different initial data/,
  },
  {
    fixtureName: "external-store-cleanup-mismatch",
    claim: ReactProofClaim.ExternalStoreConsistency,
    evidencePattern: /without symmetric deletion/,
  },
  {
    fixtureName: "effect-event-dependency",
    claim: ReactProofClaim.EffectEventUsage,
    evidencePattern: /intentionally unstable identity/,
  },
  {
    fixtureName: "effect-event-render-call",
    claim: ReactProofClaim.EffectEventUsage,
    evidencePattern: /outside an Effect or Effect Event/,
  },
  {
    fixtureName: "effect-event-prop-escape",
    claim: ReactProofClaim.EffectEventUsage,
    evidencePattern: /outside an Effect or Effect Event/,
  },
  {
    fixtureName: "effect-event-hook-escape",
    claim: ReactProofClaim.EffectEventUsage,
    evidencePattern: /outside an Effect or Effect Event/,
  },
  {
    fixtureName: "effect-event-shared-helper",
    claim: ReactProofClaim.EffectEventUsage,
    evidencePattern: /outside an Effect or Effect Event/,
  },
  {
    fixtureName: "context-provider-missing-value",
    claim: ReactProofClaim.ContextTopology,
    evidencePattern: /without a value/,
  },
  {
    fixtureName: "async-effect-stale-write",
    claim: ReactProofClaim.AsyncEffectOwnership,
    evidencePattern: /superseded/,
  },
  {
    fixtureName: "async-effect-promise-chain",
    claim: ReactProofClaim.AsyncEffectOwnership,
    evidencePattern: /superseded/,
  },
  {
    fixtureName: "helper-effect-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /has no cleanup/,
  },
  {
    fixtureName: "method-effect-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /has no cleanup/,
  },
  {
    fixtureName: "callback-parameter-effect-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /has no cleanup/,
  },
  {
    fixtureName: "object-callback-effect-listener-leak",
    claim: ReactProofClaim.EffectCleanup,
    evidencePattern: /has no cleanup/,
  },
  {
    fixtureName: "branch-returned-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "switch-returned-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "try-catch-returned-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "finally-returned-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "while-returned-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "for-of-returned-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "for-of-invoked-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
  {
    fixtureName: "for-of-destructured-render-impurity",
    claim: ReactProofClaim.RenderPurity,
    evidencePattern: /not pure during render/,
  },
];

describe("proveReactApp", () => {
  it("proves a closed React app with complete hook, render, and effect evidence", () => {
    const report = proveFixture("proved-chat");

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.projectEvidence).toEqual([]);
    expect(report.summary.units).toBe(1);
    expect(report.summary.violated).toBe(0);
    expect(report.summary.unknown).toBe(0);
    expect(
      report.units[0]?.obligations.every(
        (obligation) => obligation.status === ReactObligationStatus.Proved,
      ),
    ).toBe(true);
  });

  it.each([
    "proved-local-graph",
    "proved-timer",
    "proved-window-timeout",
    "proved-animation-frame",
    "proved-aliased-window-timeout",
    "proved-shadowed-timeout",
    "proved-custom-hook",
    "proved-cfg",
    "proved-memo",
    "proved-reducer",
    "proved-context",
    "proved-wrapped-component",
    "proved-null-component",
    "proved-default-component",
    "proved-aliased-hook",
    "proved-static-list-keys",
    "proved-mount-state-update",
    "proved-external-store",
    "proved-effect-event",
    "proved-helper-effect-cleanup",
    "proved-conditional-helper-effect-cleanup",
    "proved-listener-capture-semantics",
    "proved-mutation-observer",
    "proved-observer-constructor-only",
    "proved-abort-signal-listener",
    "proved-resize-observer",
    "proved-intersection-observer",
    "proved-multi-target-mutation-observer",
    "proved-shared-event-handler",
    "proved-event-callback-parameter",
    "proved-event-prop-flow",
    "proved-forwarded-event-prop",
    "proved-event-prop-wrapper",
    "proved-transitive-event-prop-wrapper",
    "proved-returned-event-handler",
    "proved-object-callback-flow",
    "proved-returned-use-callback-hook",
    "proved-local-object-callback",
    "proved-conditional-handler-factory",
    "proved-switch-handler-factory",
    "proved-try-catch-handler-factory",
    "proved-finally-overrides-handler",
    "proved-while-handler-factory",
    "proved-for-of-handler-factory",
    "proved-for-of-invoked-handlers",
    "proved-for-of-object-binding-handler",
    "proved-for-of-tuple-binding-handler",
    "proved-for-of-nested-binding-handler",
    "proved-helper-local-rebinding",
    "proved-branch-effect-cleanup",
    "class-component",
    "proved-pure-class-render",
    "proved-class-listener",
    "proved-class-timeout",
    "proved-class-prop-transition",
    "proved-class-pure-state-updater",
    "proved-class-primitive-state-read",
    "proved-class-state-computed-key-read",
    "proved-class-compound-prop-transition",
    "proved-class-number-literal-prop-transition",
  ])("proves the complete %s application graph", (fixtureName) => {
    const report = proveFixture(fixtureName);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.compiler.status).toBe(ReactCompilerFactStatus.Complete);
    expect(report.summary.violated).toBe(0);
    expect(report.summary.unknown).toBe(0);
  });

  it("links component rendering across module imports", () => {
    const report = proveFixture("proved-local-graph");
    const appUnit = report.graph.units.find((unit) => unit.name === "App");
    const headerUnit = report.graph.units.find((unit) => unit.name === "Header");

    expect(
      report.graph.edges.some(
        (edge) =>
          edge.kind === ReactSemanticEdgeKind.RendersComponent &&
          edge.sourceId === appUnit?.id &&
          edge.targetId === headerUnit?.id,
      ),
    ).toBe(true);
  });

  it("links custom hooks while preserving React builtin hook targets", () => {
    const report = proveFixture("proved-custom-hook");
    const counterUnit = report.graph.units.find((unit) => unit.name === "Counter");
    const counterHookUnit = report.graph.units.find((unit) => unit.name === "useCounter");

    expect(
      report.graph.hookCalls.some(
        (hookCall) =>
          hookCall.ownerId === counterUnit?.id &&
          hookCall.name === "useCounter" &&
          hookCall.targetId === counterHookUnit?.id,
      ),
    ).toBe(true);
    expect(
      report.graph.hookCalls.some(
        (hookCall) =>
          hookCall.ownerId === counterHookUnit?.id &&
          hookCall.name === "useState" &&
          hookCall.targetId === "react:useState",
      ),
    ).toBe(true);
  });

  it("records the canonical React API behind an imported alias", () => {
    const report = proveFixture("proved-aliased-hook");

    expect(report.graph.hookCalls[0]?.name).toBe("useState");
    expect(report.graph.hookCalls[0]?.targetId).toBe("react:useState");
  });

  it("extracts effect dependency, capture, and cleanup facts", () => {
    const report = proveFixture("proved-chat");
    const effect = report.graph.effects[0];

    expect(report.schemaVersion).toBe(15);
    expect(report.graph.schemaVersion).toBe(21);
    expect(effect?.hookName).toBe("useEffect");
    expect(effect?.callbackResolved).toBe(true);
    expect(effect?.dependencyMode).toBe(ReactEffectDependencyMode.Inline);
    expect(effect?.dependencies).toEqual([]);
    expect(effect?.captures).toEqual([]);
    expect(effect?.hasCleanup).toBe(true);
    expect(
      report.graph.callbacks.find((callback) => callback.id === effect?.setupCallbackId)?.phase,
    ).toBe(ReactExecutionPhase.EffectSetup);
    expect(
      report.graph.callbacks.find((callback) => callback.id === effect?.cleanupCallbackIds[0])
        ?.phase,
    ).toBe(ReactExecutionPhase.EffectCleanup);
  });

  it("certifies DOM listener identity using callback, event type, and capture", () => {
    const report = proveFixture("proved-listener-capture-semantics");
    const resource = report.graph.resources[0];
    const callback = report.graph.callbacks.find(
      (candidate) => candidate.id === resource?.callbackIds[0],
    );

    expect(resource?.kind).toBe(ReactEffectResourceKind.EventListener);
    expect(resource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Guaranteed);
    expect(resource?.disposalLocations).toHaveLength(1);
    expect(resource?.callbackComplete).toBe(true);
    expect(resource?.complete).toBe(true);
    expect(callback?.kind).toBe(ReactSemanticCallbackKind.ResourceCallback);
    expect(callback?.phase).toBe(ReactExecutionPhase.Deferred);
  });

  it("certifies AbortSignal listener disposal through the exact controller", () => {
    const report = proveFixture("proved-abort-signal-listener");
    const resource = report.graph.resources[0];

    expect(resource?.kind).toBe(ReactEffectResourceKind.EventListener);
    expect(resource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Guaranteed);
    expect(resource?.disposalLocations).toHaveLength(1);
    expect(resource?.complete).toBe(true);
  });

  it("certifies an activated observer and ignores an unactivated constructor", () => {
    const activeReport = proveFixture("proved-mutation-observer");
    const resizeReport = proveFixture("proved-resize-observer");
    const intersectionReport = proveFixture("proved-intersection-observer");
    const multiTargetReport = proveFixture("proved-multi-target-mutation-observer");
    const dormantReport = proveFixture("proved-observer-constructor-only");
    const resource = activeReport.graph.resources[0];

    expect(resource?.kind).toBe(ReactEffectResourceKind.MutationObserver);
    expect(resource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Guaranteed);
    expect(resource?.complete).toBe(true);
    expect(resizeReport.graph.resources[0]?.kind).toBe(ReactEffectResourceKind.ResizeObserver);
    expect(intersectionReport.graph.resources[0]?.kind).toBe(
      ReactEffectResourceKind.IntersectionObserver,
    );
    expect(multiTargetReport.graph.resources).toHaveLength(1);
    expect(multiTargetReport.graph.resources[0]?.activationLocations).toHaveLength(2);
    expect(dormantReport.graph.resources).toHaveLength(0);
  });

  it("fails closed for dynamic listener capture and async resource callbacks", () => {
    const dynamicCaptureReport = proveFixture("incomplete-dynamic-listener-capture");
    const accessorCaptureReport = proveFixture("incomplete-accessor-listener-capture");
    const asyncCallbackReport = proveFixture("incomplete-async-listener-callback");
    const dynamicResource = dynamicCaptureReport.graph.resources[0];
    const accessorResource = accessorCaptureReport.graph.resources[0];
    const asyncResource = asyncCallbackReport.graph.resources[0];

    expect(dynamicResource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Unknown);
    expect(dynamicResource?.complete).toBe(false);
    expect(accessorResource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Unknown);
    expect(accessorResource?.complete).toBe(false);
    expect(asyncResource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Guaranteed);
    expect(asyncResource?.callbackComplete).toBe(false);
    expect(asyncResource?.complete).toBe(false);
  });

  it("rejects user-defined EventTarget lookalikes as platform resource evidence", () => {
    const report = proveFixture("shadowed-event-target");
    const structuralReport = proveFixture("incomplete-structural-event-target");
    const refReport = proveFixture("incomplete-ref-event-target");
    const cleanupProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectCleanup);
    const structuralBoundaryProof = structuralReport.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.graph.resources).toHaveLength(0);
    expect(cleanupProof?.status).toBe(ReactObligationStatus.Proved);
    expect(structuralReport.graph.resources).toHaveLength(0);
    expect(structuralBoundaryProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(refReport.graph.resources).toHaveLength(0);
  });

  it("fails closed on a platform resource registration outside an Effect", () => {
    const report = proveFixture("incomplete-render-resource-registration");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.graph.resources).toHaveLength(0);
    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(boundaryProof?.evidence[0]?.description).toMatch(/unproved callback or disposal/);
  });

  it("certifies an interval callback in the deferred phase with guaranteed cancellation", () => {
    const report = proveFixture("proved-timer");
    const scheduler = report.graph.schedulers[0];
    const callback = report.graph.callbacks.find(
      (candidate) => candidate.id === scheduler?.callbackIds[0],
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(scheduler?.kind).toBe(ReactSchedulerKind.Interval);
    expect(scheduler?.phase).toBe(ReactExecutionPhase.Deferred);
    expect(scheduler?.cancellationStatus).toBe(ReactSchedulerCancellationStatus.Guaranteed);
    expect(scheduler?.complete).toBe(true);
    expect(callback?.kind).toBe(ReactSemanticCallbackKind.ScheduledCallback);
    expect(callback?.phase).toBe(ReactExecutionPhase.Deferred);
  });

  it("certifies platform timeout and animation-frame scheduler identities", () => {
    const timeoutReport = proveFixture("proved-window-timeout");
    const animationFrameReport = proveFixture("proved-animation-frame");

    expect(timeoutReport.status).toBe(ReactAppProofStatus.Proved);
    expect(timeoutReport.graph.schedulers[0]?.kind).toBe(ReactSchedulerKind.Timeout);
    expect(animationFrameReport.status).toBe(ReactAppProofStatus.Proved);
    expect(animationFrameReport.graph.schedulers[0]?.kind).toBe(ReactSchedulerKind.AnimationFrame);
  });

  it("resolves immutable platform aliases without trusting a shadowed scheduler name", () => {
    const aliasedReport = proveFixture("proved-aliased-window-timeout");
    const shadowedReport = proveFixture("proved-shadowed-timeout");

    expect(aliasedReport.status).toBe(ReactAppProofStatus.Proved);
    expect(aliasedReport.graph.schedulers[0]?.kind).toBe(ReactSchedulerKind.Timeout);
    expect(shadowedReport.status).toBe(ReactAppProofStatus.Proved);
    expect(shadowedReport.graph.schedulers).toEqual([]);
  });

  it("refutes a scheduler canceled by only one cleanup return alternative", () => {
    const report = proveFixture("refuted-timer-partial-cleanup");
    const schedulerProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ScheduledCallbackLifetime);

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(report.graph.schedulers[0]?.cancellationStatus).toBe(
      ReactSchedulerCancellationStatus.Missing,
    );
    expect(schedulerProof?.status).toBe(ReactObligationStatus.Violated);
  });

  it.each([
    "incomplete-mutable-timer-handle",
    "incomplete-conditional-timer-cancellation",
    "incomplete-early-return-timer-cleanup",
  ])("fails closed on an unproved scheduler handle or cleanup path in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const schedulerProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ScheduledCallbackLifetime);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.schedulers[0]?.complete).toBe(false);
    expect(schedulerProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("fails closed on a scheduler registered outside an Effect lifecycle", () => {
    const report = proveFixture("incomplete-event-timeout");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.schedulers).toEqual([]);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(boundaryProof?.evidence[0]?.description).toMatch(/deferred callback/);
  });

  it.each([
    "incomplete-timer-async-continuation",
    "incomplete-timer-floating-promise",
    "incomplete-nested-timeout",
  ])(
    "fails closed when a scheduled callback creates transitive async work in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);

      expect(report.status).toBe(ReactAppProofStatus.Incomplete);
      expect(report.graph.schedulers[0]?.callbackComplete).toBe(false);
      expect(report.graph.schedulers[0]?.complete).toBe(false);
    },
  );

  it("records an uncancellable microtask without granting lifecycle ownership", () => {
    const report = proveFixture("incomplete-effect-microtask");
    const scheduler = report.graph.schedulers[0];

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(scheduler?.kind).toBe(ReactSchedulerKind.Microtask);
    expect(scheduler?.cancellationStatus).toBe(ReactSchedulerCancellationStatus.Unknown);
    expect(scheduler?.complete).toBe(false);
  });

  it("rejects a scheduler certificate with contradictory cancellation facts", () => {
    const report = proveFixture("proved-window-timeout");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        schedulers: report.graph.schedulers.map((scheduler) => ({
          ...scheduler,
          cancellationStatus: ReactSchedulerCancellationStatus.Missing,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("completeness flag")),
    ).toBe(true);
  });

  it("rejects an Effect resource certificate with contradictory disposal facts", () => {
    const report = proveFixture("proved-mutation-observer");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        resources: report.graph.resources.map((resource) => ({
          ...resource,
          disposalStatus: ReactEffectResourceDisposalStatus.Missing,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some(
        (failure) =>
          failure.description.includes("lifetime certificate") ||
          failure.description.includes("Effect resource facts require"),
      ),
    ).toBe(true);
  });

  it("rejects an Effect resource callback without a certified owner channel", () => {
    const report = proveFixture("proved-mutation-observer");
    const resourceCallbackIds = new Set(
      report.graph.resources.flatMap((resource) => resource.callbackIds),
    );
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbacks: report.graph.callbacks.map((callback) =>
          resourceCallbackIds.has(callback.id)
            ? {
                ...callback,
                ownerId: "unknown-resource-owner",
              }
            : callback,
        ),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some(
        (failure) =>
          failure.description.includes("no certified owner channel") ||
          failure.description.includes("unknown owner unit"),
      ),
    ).toBe(true);
  });

  it("assigns memo, event, and reducer callbacks to execution phases", () => {
    const memoReport = proveFixture("proved-memo");
    const reducerReport = proveFixture("proved-reducer");

    expect(
      memoReport.graph.callbacks.some(
        (callback) =>
          callback.kind === ReactSemanticCallbackKind.MemoizedCallback &&
          callback.phase === ReactExecutionPhase.Deferred,
      ),
    ).toBe(true);
    expect(
      memoReport.graph.callbacks.some(
        (callback) =>
          callback.kind === ReactSemanticCallbackKind.EventHandler &&
          callback.phase === ReactExecutionPhase.Event,
      ),
    ).toBe(true);
    expect(
      reducerReport.graph.callbacks.some(
        (callback) =>
          callback.kind === ReactSemanticCallbackKind.Reducer &&
          callback.phase === ReactExecutionPhase.StateTransition,
      ),
    ).toBe(true);
  });

  it("propagates React execution phases through project helpers", () => {
    const memoReport = proveFixture("proved-memo");
    const reducerReport = proveFixture("proved-reducer");
    const effectEventReport = proveFixture("proved-effect-event");
    const memoHelpers = memoReport.graph.reachableFunctions.filter(
      (reachableFunction) => reachableFunction.name === "doubleCount",
    );
    const deferredHelpers = memoReport.graph.reachableFunctions.filter(
      (reachableFunction) => reachableFunction.name === "getNextCount",
    );
    const reducerHelper = reducerReport.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "incrementCount",
    );
    const effectEventHelper = effectEventReport.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "installPointerListener",
    );
    const effectEventCallbackHelper = effectEventReport.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "normalizePosition",
    );

    expect(memoHelpers.some((helper) => helper.phase === ReactExecutionPhase.Render)).toBe(true);
    expect(deferredHelpers.some((helper) => helper.phase === ReactExecutionPhase.Deferred)).toBe(
      true,
    );
    expect(deferredHelpers.some((helper) => helper.phase === ReactExecutionPhase.Event)).toBe(true);
    expect(reducerHelper?.phase).toBe(ReactExecutionPhase.StateTransition);
    expect(effectEventHelper?.phase).toBe(ReactExecutionPhase.EffectSetup);
    expect(effectEventCallbackHelper?.phase).toBe(ReactExecutionPhase.EffectEvent);
  });

  it("links external-store callbacks to render, server-render, and subscription phases", () => {
    const report = proveFixture("proved-external-store");
    const hydrationReport = proveFixture("mismatched-server-snapshot");
    const externalStore = report.graph.externalStores[0];
    const hydrationStore = hydrationReport.graph.externalStores[0];

    expect(externalStore).toBeDefined();
    expect(
      report.graph.callbacks.find(
        (callback) => callback.id === externalStore?.subscribeCallbackIds[0],
      )?.phase,
    ).toBe(ReactExecutionPhase.ExternalStoreSubscription);
    expect(
      report.graph.callbacks.find(
        (callback) => callback.id === externalStore?.snapshotCallbackIds[0],
      )?.phase,
    ).toBe(ReactExecutionPhase.Render);
    expect(externalStore?.serverSnapshotCallbackIds).toEqual([]);
    expect(externalStore?.serverSnapshotProvided).toBe(false);
    expect(
      hydrationReport.graph.callbacks.find(
        (callback) => callback.id === hydrationStore?.serverSnapshotCallbackIds[0],
      )?.phase,
    ).toBe(ReactExecutionPhase.ServerRender);
  });

  it("proves external-store callback props across all protocol phases", () => {
    const report = proveFixture("proved-external-store-callback-props");
    const externalStore = report.graph.externalStores[0];
    const propFlowPhases = report.graph.callbackPropFlows.map((propFlow) => propFlow.phase);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(externalStore?.subscribeComplete).toBe(true);
    expect(externalStore?.snapshotComplete).toBe(true);
    expect(externalStore?.serverSnapshotComplete).toBe(true);
    expect(externalStore?.subscribeCallbackIds).toHaveLength(1);
    expect(externalStore?.snapshotCallbackIds).toHaveLength(1);
    expect(externalStore?.serverSnapshotCallbackIds).toHaveLength(1);
    expect(propFlowPhases).toEqual(
      expect.arrayContaining([
        ReactExecutionPhase.ExternalStoreSubscription,
        ReactExecutionPhase.Render,
        ReactExecutionPhase.ServerRender,
      ]),
    );
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each([
    ["fresh-external-store-callback-prop-snapshot", /fresh or missing value/],
    ["mismatched-external-store-callback-prop-server-snapshot", /different initial data/],
  ])("refutes an invalid external-store callback-prop protocol in %s", (fixtureName, evidence) => {
    const report = proveFixture(fixtureName);
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ExternalStoreConsistency &&
          obligation.status === ReactObligationStatus.Violated,
      );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(
      consistencyProof?.evidence.some((proofEvidence) => evidence.test(proofEvidence.description)),
    ).toBe(true);
  });

  it("proves external-store callback props forwarded through a finite JSX spread", () => {
    const report = proveFixture("proved-external-store-callback-prop-spread");
    const externalStore = report.graph.externalStores[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(externalStore?.subscribeComplete).toBe(true);
    expect(externalStore?.snapshotComplete).toBe(true);
    expect(report.graph.callbackPropFlows.every((propFlow) => propFlow.complete)).toBe(true);
  });

  it("fails closed when intra-attribute external-store callbacks use different guards", () => {
    const report = proveFixture("incomplete-external-store-callback-prop-conditional-join");
    const externalStore = report.graph.externalStores[0];
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ExternalStoreConsistency);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(externalStore?.subscribeComplete).toBe(true);
    expect(externalStore?.subscribeCallbackIds).toHaveLength(2);
    expect(consistencyProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("fails closed when a callback factory receives different scalar guards", () => {
    const report = proveFixture("incomplete-external-store-conditional-factory");
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ExternalStoreConsistency);
    const guardIds = new Set(
      report.graph.callbackPropFlows.flatMap((propFlow) =>
        propFlow.alternatives.flatMap((alternative) => alternative.guards.map((guard) => guard.id)),
      ),
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(consistencyProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(
      report.graph.callbackPropFlows
        .flatMap((propFlow) => propFlow.alternatives)
        .every((alternative) => alternative.guards.length === 1),
    ).toBe(true);
    expect(guardIds.size).toBe(2);
  });

  it("fails closed when a callback guard is written between JSX attributes", () => {
    const report = proveFixture("incomplete-external-store-mutated-conditional-props");
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ExternalStoreConsistency);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(consistencyProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(
      report.graph.callbackPropFlows
        .flatMap((propFlow) => propFlow.alternatives)
        .every((alternative) => alternative.guards.length === 0),
    ).toBe(true);
  });

  it("proves a callback factory whose scalar guard is substituted from one caller symbol", () => {
    const report = proveFixture("proved-external-store-conditional-factory");
    const guardIds = new Set(
      report.graph.callbackPropFlows.flatMap((propFlow) =>
        propFlow.alternatives.flatMap((alternative) => alternative.guards.map((guard) => guard.id)),
      ),
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(guardIds.size).toBe(1);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes crossed callback-factory results under one substituted scalar guard", () => {
    const report = proveFixture("mismatched-external-store-conditional-factory");
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ExternalStoreConsistency &&
          obligation.status === ReactObligationStatus.Violated,
      );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(
      consistencyProof?.evidence.some((evidence) =>
        evidence.description.includes("changes without notifying"),
      ),
    ).toBe(true);
  });

  it("proves intra-attribute external-store callbacks selected by the same guard", () => {
    const report = proveFixture("proved-external-store-conditional-props");
    const guardedFlows = report.graph.callbackPropFlows.filter((propFlow) =>
      propFlow.alternatives.some((alternative) => alternative.guards.length > 0),
    );
    const guardIds = new Set(
      guardedFlows.flatMap((propFlow) =>
        propFlow.alternatives.flatMap((alternative) => alternative.guards.map((guard) => guard.id)),
      ),
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(guardedFlows).toHaveLength(3);
    expect(guardedFlows.every((propFlow) => propFlow.alternatives.length === 2)).toBe(true);
    expect(guardIds.size).toBe(1);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes crossed external-store callbacks selected by the same guard", () => {
    const report = proveFixture("mismatched-external-store-conditional-props");
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ExternalStoreConsistency &&
          obligation.status === ReactObligationStatus.Violated,
      );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(
      consistencyProof?.evidence.some((evidence) =>
        evidence.description.includes("changes without notifying"),
      ),
    ).toBe(true);
  });

  it("proves separately correlated external-store render branches", () => {
    const report = proveFixture("proved-external-store-render-branch-props");
    const externalStoreFlows = report.graph.callbackPropFlows.filter(
      (propFlow) =>
        propFlow.phase === ReactExecutionPhase.ExternalStoreSubscription ||
        propFlow.phase === ReactExecutionPhase.Render ||
        propFlow.phase === ReactExecutionPhase.ServerRender,
    );
    const renderIds = new Set(externalStoreFlows.map((propFlow) => propFlow.renderId));

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(renderIds.size).toBe(2);
    expect(externalStoreFlows).toHaveLength(6);
    expect(externalStoreFlows.every((propFlow) => propFlow.complete)).toBe(true);
  });

  it("refutes a silent store write in one correlated render branch", () => {
    const report = proveFixture("silent-external-store-render-branch-props");
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ExternalStoreConsistency &&
          obligation.status === ReactObligationStatus.Violated,
      );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(
      consistencyProof?.evidence.some((evidence) =>
        evidence.description.includes("secondaryVersion changes without notifying"),
      ),
    ).toBe(true);
  });

  it("resolves context sources through exact identity and nearest-provider render paths", () => {
    const report = proveFixture("proved-context-topology");
    const context = report.graph.contexts[0];
    const outerProvider = report.graph.contextProviders.find(
      (provider) => provider.valueText === '"outer"',
    );
    const innerProvider = report.graph.contextProviders.find(
      (provider) => provider.valueText === '"inner"',
    );
    const consumerSources = report.graph.contextConsumers.flatMap(
      (consumer) => consumer.sourceProviderIds,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(context?.defaultValueText).toBe('"default"');
    expect(consumerSources).toContain(outerProvider?.id);
    expect(consumerSources).toContain(innerProvider?.id);
    expect(report.graph.contextConsumers.every((consumer) => consumer.topologyComplete)).toBe(true);
  });

  it("keeps distinct createContext calls as distinct runtime identities", () => {
    const report = proveFixture("proved-context-identity");
    const consumer = report.graph.contextConsumers[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.contexts).toHaveLength(2);
    expect(consumer?.usesDefaultValue).toBe(true);
    expect(consumer?.sourceProviderIds).toEqual([]);
  });

  it("fails closed when a library context has no project proof contract", () => {
    const report = proveFixture("external-context");
    const contextProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ContextTopology);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(contextProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(contextProof?.evidence[0]?.description).toMatch(/could not be resolved/);
  });

  it("fails closed when an async Effect uses an opaque latest-task guard", () => {
    const report = proveFixture("async-effect-opaque-guard");
    const ownershipProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.AsyncEffectOwnership);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(ownershipProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(ownershipProof?.evidence[0]?.description).toMatch(/unmodeled ownership guard/);
  });

  it("fails closed when a Promise continuation callback has no project summary", () => {
    const report = proveFixture("async-effect-opaque-continuation");
    const ownershipProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.AsyncEffectOwnership);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(ownershipProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(ownershipProof?.evidence[0]?.description).toMatch(/no checked React ownership summary/);
  });

  it("fails closed for an unclassified mutation after an async suspension", () => {
    const report = proveFixture("async-effect-post-await-mutation");
    const ownershipProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.AsyncEffectOwnership);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(ownershipProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(ownershipProof?.evidence[0]?.description).toMatch(/no checked React ownership summary/);
  });

  it("requires every cleanup path to invalidate an async task", () => {
    const report = proveFixture("async-effect-path-dependent-invalidation");
    const ownershipProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.AsyncEffectOwnership);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(ownershipProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(ownershipProof?.evidence[0]?.description).toMatch(/unmodeled ownership guard/);
  });

  it("follows project helpers when checking Effect state transitions", () => {
    const report = proveFixture("helper-effect-state-update");
    const stateUpdateProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectStateUpdates);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(stateUpdateProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(stateUpdateProof?.evidence[0]?.description).toMatch(/fixpoint proof/);
  });

  it("records async Effect ownership and links the task to its source Effect", () => {
    const safeReport = proveFixture("incomplete-async-effect-ignore-contract");
    const unsafeReport = proveFixture("async-effect-stale-write");
    const safeTask = safeReport.graph.asyncTasks[0];
    const unsafeTask = unsafeReport.graph.asyncTasks[0];

    expect(safeTask?.ownershipStatus).toBe(ReactAsyncOwnershipStatus.Guarded);
    expect(safeTask?.stateWrites).toEqual(["setResult"]);
    expect(safeReport.graph.effects.some((effect) => effect.id === safeTask?.effectId)).toBe(true);
    expect(unsafeTask?.ownershipStatus).toBe(ReactAsyncOwnershipStatus.Unguarded);
  });

  it.each([
    "incomplete-async-effect-ignore-contract",
    "incomplete-async-effect-abort-contract",
    "incomplete-async-effect-promise-ignore-contract",
  ])("keeps guarded async ownership separate from the opaque %s loader contract", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const ownershipProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.AsyncEffectOwnership);
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(ownershipProof?.status).toBe(ReactObligationStatus.Proved);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("records project helpers under their React execution phases", () => {
    const report = proveFixture("proved-helper-effect-cleanup");
    const setupHelper = report.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "installResizeListener",
    );
    const cleanupHelper = report.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "removeResizeListener",
    );

    expect(setupHelper?.phase).toBe(ReactExecutionPhase.EffectSetup);
    expect(cleanupHelper?.phase).toBe(ReactExecutionPhase.EffectCleanup);
    expect(setupHelper?.isConditionallyReached).toBe(false);
    expect(
      report.graph.callbacks.some((callback) => callback.id === setupHelper?.rootCallbackId),
    ).toBe(true);
  });

  it("proves unconditional disposal for a conditional Effect acquisition", () => {
    const report = proveFixture("proved-conditional-helper-effect-cleanup");
    const setupHelper = report.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "installResizeListener",
    );
    const cleanupProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectCleanup);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(setupHelper?.isConditionallyReached).toBe(true);
    expect(cleanupProof?.status).toBe(ReactObligationStatus.Proved);
  });

  it("keeps the strongest reachability fact when a helper has multiple paths", () => {
    const report = proveFixture("event-handler-boundary");
    const incrementHelper = report.graph.reachableFunctions.find(
      (reachableFunction) =>
        reachableFunction.name === "increment" &&
        reachableFunction.phase === ReactExecutionPhase.Event,
    );

    expect(incrementHelper?.isConditionallyReached).toBe(false);
  });

  it("scopes a shared callback identity to each owning React unit", () => {
    const report = proveFixture("proved-shared-event-handler");
    const callbackIds = report.graph.callbacks.map((callback) => callback.id);
    const eventCallbacks = report.graph.callbacks.filter(
      (callback) => callback.kind === ReactSemanticCallbackKind.EventHandler,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(eventCallbacks).toHaveLength(2);
    expect(new Set(callbackIds).size).toBe(callbackIds.length);
  });

  it("propagates render and event phases through a synchronous list callback", () => {
    const report = proveFixture("mapped-event-handler");
    const renderCallback = report.graph.callbacks.find(
      (callback) => callback.kind === ReactSemanticCallbackKind.ComponentRender,
    );
    const renderIteration = report.graph.reachableFunctions.find(
      (reachableFunction) =>
        reachableFunction.rootCallbackId === renderCallback?.id &&
        reachableFunction.phase === ReactExecutionPhase.Render,
    );
    const eventHelper = report.graph.reachableFunctions.find(
      (reachableFunction) =>
        reachableFunction.name === "selectItem" &&
        reachableFunction.phase === ReactExecutionPhase.Event,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(renderCallback?.phase).toBe(ReactExecutionPhase.Render);
    expect(renderIteration?.isConditionallyReached).toBe(true);
    expect(eventHelper).toBeDefined();
    expect(
      report.graph.functionCalls.some(
        (functionCall) =>
          functionCall.kind === ReactSemanticFunctionCallKind.SynchronousCallback &&
          functionCall.phase === ReactExecutionPhase.Render,
      ),
    ).toBe(true);
  });

  it("binds a source callback argument to an invoked helper parameter", () => {
    const report = proveFixture("proved-event-callback-parameter");
    const updateCount = report.graph.reachableFunctions.find(
      (reachableFunction) =>
        reachableFunction.name === "updateCount" &&
        reachableFunction.phase === ReactExecutionPhase.Event,
    );
    const parameterCall = report.graph.functionCalls.find(
      (functionCall) =>
        functionCall.targetFunctionId === updateCount?.id &&
        functionCall.kind === ReactSemanticFunctionCallKind.Parameter,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(parameterCall?.phase).toBe(ReactExecutionPhase.Event);
    expect(parameterCall?.sourceParameterIndex).toBe(0);
    expect(parameterCall?.callArgumentIndex).toBeNull();
  });

  it("propagates event phase through component callback props", () => {
    const report = proveFixture("proved-forwarded-event-prop");
    const eventCallback = report.graph.callbacks.find(
      (callback) =>
        callback.kind === ReactSemanticCallbackKind.EventHandler &&
        callback.name === "event handler",
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(eventCallback?.phase).toBe(ReactExecutionPhase.Event);
    expect(report.graph.eventBindings).toHaveLength(1);
    expect(report.graph.eventBindings[0]?.complete).toBe(true);
    expect(report.graph.eventBindings[0]?.callbackIds).toEqual([eventCallback?.id]);
    expect(report.graph.callbackPropFlows).toHaveLength(2);
    expect(report.graph.callbackPropFlows.every((propFlow) => propFlow.complete)).toBe(true);
  });

  it("retains captured callback bindings in a returned event handler", () => {
    const report = proveFixture("proved-returned-event-handler");
    const increment = report.graph.reachableFunctions.find(
      (reachableFunction) =>
        reachableFunction.name === "increment" &&
        reachableFunction.phase === ReactExecutionPhase.Event,
    );
    const capturedCall = report.graph.functionCalls.find(
      (functionCall) =>
        functionCall.kind === ReactSemanticFunctionCallKind.Captured &&
        functionCall.targetFunctionId === increment?.id,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(capturedCall?.phase).toBe(ReactExecutionPhase.Event);
    expect(capturedCall?.sourceParameterIndex).toBeNull();
    expect(capturedCall?.sourcePropertyPath).toEqual([]);
  });

  it("propagates callback values through object properties", () => {
    const report = proveFixture("proved-object-callback-flow");
    const increment = report.graph.reachableFunctions.find(
      (reachableFunction) =>
        reachableFunction.name === "increment" &&
        reachableFunction.phase === ReactExecutionPhase.Event,
    );
    const propertyCall = report.graph.functionCalls.find(
      (functionCall) =>
        functionCall.kind === ReactSemanticFunctionCallKind.Property &&
        functionCall.targetFunctionId === increment?.id,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(propertyCall?.sourceParameterIndex).toBe(0);
    expect(propertyCall?.sourcePropertyPath).toEqual(["callback"]);
  });

  it("resolves every exhaustive path through a callback factory", () => {
    const report = proveFixture("proved-conditional-handler-factory");
    const eventBinding = report.graph.eventBindings[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(eventBinding?.complete).toBe(true);
    expect(eventBinding?.callbackIds).toHaveLength(2);
  });

  it("uses literal-union coverage to resolve every switch-selected callback", () => {
    const report = proveFixture("proved-switch-handler-factory");
    const eventBinding = report.graph.eventBindings[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(eventBinding?.complete).toBe(true);
    expect(eventBinding?.callbackIds).toHaveLength(2);
  });

  it("resolves both normal and exceptional callback factory returns", () => {
    const report = proveFixture("proved-try-catch-handler-factory");
    const eventBinding = report.graph.eventBindings[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(eventBinding?.complete).toBe(true);
    expect(eventBinding?.callbackIds).toHaveLength(2);
  });

  it("removes a protected callback when finally always overrides its return", () => {
    const report = proveFixture("proved-finally-overrides-handler");

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(
      report.units
        .flatMap((unit) => unit.obligations)
        .find((obligation) => obligation.claim === ReactProofClaim.RenderPurity)?.status,
    ).toBe(ReactObligationStatus.Proved);
  });

  it.each(["proved-while-handler-factory", "proved-for-of-handler-factory"])(
    "resolves every termination-proved loop return in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const eventBinding = report.graph.eventBindings[0];

      expect(report.status).toBe(ReactAppProofStatus.Proved);
      expect(eventBinding?.complete).toBe(true);
      expect(eventBinding?.callbackIds).toHaveLength(2);
    },
  );

  it("joins literal iteration values before invoking event callbacks", () => {
    const report = proveFixture("proved-for-of-invoked-handlers");
    const invokedNames = report.graph.functionCalls
      .filter((functionCall) => functionCall.kind === ReactSemanticFunctionCallKind.Captured)
      .map(
        (functionCall) =>
          report.graph.reachableFunctions.find(
            (reachableFunction) => reachableFunction.id === functionCall.targetFunctionId,
          )?.name,
      );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(invokedNames).toEqual(expect.arrayContaining(["firstHandler", "secondHandler"]));
  });

  it("carries conditional callback props through transitive event wrappers", () => {
    const report = proveFixture("proved-transitive-event-prop-wrapper");
    const eventPropFlow = report.graph.callbackPropFlows[0];
    const invokedNames = report.graph.functionCalls
      .filter((functionCall) => functionCall.phase === ReactExecutionPhase.Event)
      .map(
        (functionCall) =>
          report.graph.reachableFunctions.find(
            (reachableFunction) => reachableFunction.id === functionCall.targetFunctionId,
          )?.name,
      );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.eventBindings[0]?.complete).toBe(true);
    expect(eventPropFlow?.complete).toBe(true);
    expect(eventPropFlow?.callbackIds).toHaveLength(2);
    expect(invokedNames).toEqual(
      expect.arrayContaining(["invokeAction", "recordPrimaryAction", "recordSecondaryAction"]),
    );
  });

  it.each([
    "proved-for-of-object-binding-handler",
    "proved-for-of-tuple-binding-handler",
    "proved-for-of-nested-binding-handler",
  ])("projects finite iteration values through destructured bindings in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const eventBinding = report.graph.eventBindings[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(eventBinding?.complete).toBe(true);
    expect(eventBinding?.callbackIds).toHaveLength(2);
  });

  it("allows helper-local rebinding while leaving mutable iteration flow incomplete", () => {
    const report = proveFixture("incomplete-for-of-mutable-handler");
    const purityProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.RenderPurity);
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(purityProof?.status).toBe(ReactObligationStatus.Proved);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("rejects a certificate that drops a branch-selected event callback", () => {
    const report = proveFixture("proved-conditional-handler-factory");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        eventBindings: report.graph.eventBindings.map((eventBinding) => ({
          ...eventBinding,
          callbackIds: eventBinding.callbackIds.slice(0, 1),
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("not referenced by an event channel"),
      ),
    ).toBe(true);
  });

  it.each([
    "incomplete-async-effect-ignore-contract",
    "incomplete-async-effect-abort-contract",
    "incomplete-async-effect-promise-ignore-contract",
    "async-effect-stale-write",
    "async-effect-promise-chain",
    "async-effect-opaque-guard",
    "async-effect-opaque-continuation",
    "async-effect-post-await-mutation",
    "async-effect-path-dependent-invalidation",
    "helper-effect-state-update",
    "incomplete-dynamic-listener-capture",
    "incomplete-accessor-listener-capture",
    "incomplete-async-listener-callback",
    "incomplete-render-resource-registration",
    "incomplete-structural-event-target",
    "incomplete-ref-event-target",
    "incomplete-ambiguous-observer-kind",
    "invalid-hook-helper",
    "class-component",
    "named-memo-impure-helper",
    "external-store-helper-boundary",
    "proved-external-store-callback-props",
    "proved-external-store-conditional-props",
    "proved-external-store-conditional-factory",
    "proved-external-store-render-branch-props",
    "fresh-external-store-callback-prop-snapshot",
    "silent-external-store-render-branch-props",
    "mismatched-external-store-callback-prop-server-snapshot",
    "mismatched-external-store-conditional-props",
    "mismatched-external-store-conditional-factory",
    "proved-external-store-callback-prop-spread",
    "incomplete-external-store-callback-prop-conditional-join",
    "incomplete-external-store-conditional-factory",
    "incomplete-external-store-mutated-conditional-props",
    "effect-event-shared-helper",
    "proved-shared-event-handler",
    "mapped-event-handler",
    "render-callback-parameter-impurity",
    "proved-event-callback-parameter",
    "callback-parameter-effect-listener-leak",
    "callback-parameter-opaque-registration",
    "proved-event-prop-flow",
    "proved-forwarded-event-prop",
    "proved-event-prop-spread",
    "proved-rest-event-prop-spread",
    "proved-intrinsic-event-prop-spread",
    "proved-jsx-spread-trailing-explicit-event",
    "proved-jsx-spread-trailing-spread-event",
    "incomplete-jsx-spread-leading-explicit-event",
    "incomplete-jsx-spread-open-ended-event",
    "incomplete-jsx-spread-mutated-object",
    "proved-effect-callback-prop",
    "proved-mixed-phase-callback-prop",
    "proved-cleanup-callback-prop",
    "incomplete-defaulted-event-prop-wrapper",
    "incomplete-computed-event-prop-wrapper",
    "incomplete-local-object-callback-spread",
    "proved-event-prop-wrapper",
    "proved-transitive-event-prop-wrapper",
    "proved-returned-event-handler",
    "render-returned-callback-impurity",
    "proved-object-callback-flow",
    "object-callback-effect-listener-leak",
    "incomplete-object-callback-spread",
    "proved-conditional-handler-factory",
    "proved-switch-handler-factory",
    "proved-try-catch-handler-factory",
    "proved-finally-overrides-handler",
    "proved-while-handler-factory",
    "proved-for-of-handler-factory",
    "proved-for-of-invoked-handlers",
    "proved-for-of-object-binding-handler",
    "proved-for-of-tuple-binding-handler",
    "proved-for-of-nested-binding-handler",
    "proved-helper-local-rebinding",
    "proved-branch-effect-cleanup",
    "incomplete-partial-handler-factory",
    "incomplete-switch-fallthrough-handler-factory",
    "incomplete-switch-uncovered-handler-factory",
    "incomplete-try-catch-handler-factory",
    "incomplete-while-handler-factory",
    "incomplete-for-of-spread-handler-factory",
    "incomplete-for-of-mutable-handler",
    "incomplete-for-of-defaulted-handler",
    "incomplete-for-of-rest-binding-handler",
    "incomplete-for-of-computed-binding-handler",
    "proved-returned-use-callback-hook",
    "proved-local-object-callback",
    "incomplete-ref-backed-event-callback",
    "incomplete-mutable-object-callback",
    "proved-window-timeout",
    "proved-animation-frame",
    "proved-aliased-window-timeout",
    "proved-shadowed-timeout",
    "incomplete-event-timeout",
    "incomplete-mutable-timer-handle",
    "refuted-timer-partial-cleanup",
    "incomplete-conditional-timer-cancellation",
    "incomplete-early-return-timer-cleanup",
    "incomplete-timer-async-continuation",
    "incomplete-timer-floating-promise",
    "incomplete-effect-microtask",
    "incomplete-nested-timeout",
  ])("independently checks the %s proof certificate", (fixtureName) => {
    const certificate = checkReactProofReport(proveFixture(fixtureName));

    expect(certificate.status).toBe(ReactProofCertificateStatus.Valid);
    expect(certificate.failures).toEqual([]);
  });

  it("rejects a report whose global verdict contradicts its obligations", () => {
    const report = proveFixture("async-effect-stale-write");
    const certificate = checkReactProofReport({
      ...report,
      status: ReactAppProofStatus.Proved,
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(certificate.failures.some((failure) => failure.subjectId === "report-status")).toBe(
      true,
    );
  });

  it("rejects a report whose async fact contradicts its unit theorem", () => {
    const report = proveFixture("incomplete-async-effect-ignore-contract");
    const firstTask = report.graph.asyncTasks[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        asyncTasks: firstTask
          ? [
              {
                ...firstTask,
                ownershipStatus: ReactAsyncOwnershipStatus.Unguarded,
              },
              ...report.graph.asyncTasks.slice(1),
            ]
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("Async Effect ownership facts require"),
      ),
    ).toBe(true);
  });

  it("rejects a reachable function whose phase contradicts its root callback", () => {
    const report = proveFixture("proved-helper-effect-cleanup");
    const firstReachableFunction = report.graph.reachableFunctions[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        reachableFunctions: firstReachableFunction
          ? [
              {
                ...firstReachableFunction,
                phase: ReactExecutionPhase.Event,
              },
              ...report.graph.reachableFunctions.slice(1),
            ]
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("different execution phases"),
      ),
    ).toBe(true);
  });

  it("rejects a parameter call with an impossible flow index shape", () => {
    const report = proveFixture("proved-event-callback-parameter");
    const parameterCall = report.graph.functionCalls.find(
      (functionCall) => functionCall.kind === ReactSemanticFunctionCallKind.Parameter,
    );
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        functionCalls: parameterCall
          ? report.graph.functionCalls.map((functionCall) =>
              functionCall.id === parameterCall.id
                ? {
                    ...functionCall,
                    sourceParameterIndex: null,
                  }
                : functionCall,
            )
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("indexes inconsistent with its flow kind"),
      ),
    ).toBe(true);
  });

  it("rejects a complete event prop flow without a source callback", () => {
    const report = proveFixture("proved-event-prop-flow");
    const firstPropFlow = report.graph.callbackPropFlows[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbackPropFlows: firstPropFlow
          ? [
              {
                ...firstPropFlow,
                callbackIds: [],
              },
              ...report.graph.callbackPropFlows.slice(1),
            ]
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("complete callback prop flow has no source callback"),
      ),
    ).toBe(true);
  });

  it("rejects a callback prop flow whose source has a different phase", () => {
    const report = proveFixture("proved-effect-callback-prop");
    const firstPropFlow = report.graph.callbackPropFlows[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbackPropFlows: firstPropFlow
          ? [
              {
                ...firstPropFlow,
                phase: ReactExecutionPhase.Event,
              },
              ...report.graph.callbackPropFlows.slice(1),
            ]
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("mismatched execution phase"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate guard identities in a callback prop alternative", () => {
    const report = proveFixture("proved-external-store-conditional-props");
    const guardedPropFlow = report.graph.callbackPropFlows.find((propFlow) =>
      propFlow.alternatives.some((alternative) => alternative.guards.length > 0),
    );
    const guardedAlternative = guardedPropFlow?.alternatives.find(
      (alternative) => alternative.guards.length > 0,
    );
    const firstGuard = guardedAlternative?.guards[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbackPropFlows:
          guardedPropFlow && guardedAlternative && firstGuard
            ? report.graph.callbackPropFlows.map((propFlow) =>
                propFlow.id === guardedPropFlow.id
                  ? {
                      ...propFlow,
                      alternatives: propFlow.alternatives.map((alternative) =>
                        alternative === guardedAlternative
                          ? {
                              ...alternative,
                              guards: [...alternative.guards, firstGuard],
                            }
                          : alternative,
                      ),
                    }
                  : propFlow,
              )
            : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("invalid guard identities"),
      ),
    ).toBe(true);
  });

  it("rejects a complete external-store channel without its callback", () => {
    const report = proveFixture("proved-external-store");
    const externalStore = report.graph.externalStores[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        externalStores: externalStore
          ? [
              {
                ...externalStore,
                snapshotCallbackIds: [],
              },
              ...report.graph.externalStores.slice(1),
            ]
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("complete external-store snapshot has no callback"),
      ),
    ).toBe(true);
  });

  it("rejects an external-store callback prop without its owner channel", () => {
    const report = proveFixture("proved-external-store-callback-props");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbackPropFlows: [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("no certified owner channel"),
      ),
    ).toBe(true);
  });

  it("rejects a callback prop flow with an unknown render site", () => {
    const report = proveFixture("proved-external-store-render-branch-props");
    const firstPropFlow = report.graph.callbackPropFlows[0];
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbackPropFlows: firstPropFlow
          ? [
              {
                ...firstPropFlow,
                renderId: "unknown-render-site",
              },
              ...report.graph.callbackPropFlows.slice(1),
            ]
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("unknown render site")),
    ).toBe(true);
  });

  it("rejects a property call without a property path", () => {
    const report = proveFixture("proved-object-callback-flow");
    const propertyCall = report.graph.functionCalls.find(
      (functionCall) => functionCall.kind === ReactSemanticFunctionCallKind.Property,
    );
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        functionCalls: propertyCall
          ? report.graph.functionCalls.map((functionCall) =>
              functionCall.id === propertyCall.id
                ? {
                    ...functionCall,
                    sourcePropertyPath: [],
                  }
                : functionCall,
            )
          : [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("indexes inconsistent with its flow kind"),
      ),
    ).toBe(true);
  });

  it("records Effect Event captures, execution phase, and intentionally unstable identity", () => {
    const report = proveFixture("proved-effect-event");
    const effectEvent = report.graph.effectEvents[0];
    const callback = report.graph.callbacks.find(
      (candidateCallback) => candidateCallback.id === effectEvent?.callbackId,
    );

    expect(effectEvent?.identityStability).toBe(ReactIdentityStability.Unstable);
    expect(callback?.kind).toBe(ReactSemanticCallbackKind.EffectEvent);
    expect(callback?.phase).toBe(ReactExecutionPhase.EffectEvent);
    expect(callback?.captures).toContain("canMove");
  });

  it("allows an Effect helper to register an Effect Event", () => {
    const report = proveFixture("proved-effect-event");
    const effectEventProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectEventUsage);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(effectEventProof?.status).toBe(ReactObligationStatus.Proved);
  });

  it("normalizes React Compiler HIR into a control-flow graph", () => {
    const report = proveFixture("proved-cfg");
    const compilerFunction = report.graph.compiler.functions.find(
      (functionFact) => functionFact.blocks.length > 1,
    );

    expect(report.graph.compiler.status).toBe(ReactCompilerFactStatus.Complete);
    expect(report.graph.compiler.version).toBe("babel-plugin-react-compiler@1.0.0");
    expect(report.graph.compiler.phase).toBe("InferReactivePlaces");
    expect(compilerFunction).toBeDefined();
    expect(
      compilerFunction?.blocks.some(
        (block) => block.successors.length > 1 || block.predecessors.length > 1,
      ),
    ).toBe(true);
    expect(compilerFunction?.blocks.flatMap((block) => block.instructions).length).toBeGreaterThan(
      0,
    );
  });

  it.each(REFUTED_FIXTURES)(
    "refutes $fixtureName with a source-level $claim counterexample",
    ({ fixtureName, claim, evidencePattern }) => {
      const report = proveFixture(fixtureName);
      const violatedObligation = report.units
        .flatMap((unit) => unit.obligations)
        .find(
          (obligation) =>
            obligation.claim === claim && obligation.status === ReactObligationStatus.Violated,
        );

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(violatedObligation).toBeDefined();
      expect(violatedObligation?.evidence[0]?.description).toMatch(evidencePattern);
      expect(violatedObligation?.evidence[0]?.trace.length).toBeGreaterThan(0);
      expect(violatedObligation?.evidence[0]?.location.line).toBeGreaterThan(0);
    },
  );

  it("fails closed when render purity depends on an opaque call", () => {
    const report = proveFixture("opaque-render-call");
    const purityProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.RenderPurity);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(purityProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(purityProof?.evidence[0]?.description).toMatch(/no render-purity contract/);
  });

  it("proves a locally resolved state-update event callback", () => {
    const report = proveFixture("event-handler-boundary");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Proved);
  });

  it("fails closed when effect state updates need a rerender fixpoint proof", () => {
    const report = proveFixture("effect-state-update");
    const stateUpdateProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectStateUpdates);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(stateUpdateProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(stateUpdateProof?.evidence[0]?.description).toMatch(/fixpoint proof/);
  });

  it("fails closed for the pinned memo-context Effect Event runtime gap", () => {
    const report = proveFixture("effect-event-memo-context");
    const effectEventProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectEventUsage);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(effectEventProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(effectEventProof?.evidence[0]?.description).toMatch(/stale context capture/);
  });

  it("fails closed when an Effect Event crosses an opaque registration contract", () => {
    const report = proveFixture("effect-event-opaque-registration");
    const effectEventProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectEventUsage);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(effectEventProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(effectEventProof?.evidence[0]?.description).toMatch(/unmodeled registration/);
  });

  it("fails closed when a source callback crosses an opaque registration boundary", () => {
    const report = proveFixture("callback-parameter-opaque-registration");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(boundaryProof?.evidence[0]?.description).toMatch(/callable-value boundary/);
  });

  it.each([
    "proved-event-prop-spread",
    "proved-rest-event-prop-spread",
    "proved-intrinsic-event-prop-spread",
  ])("proves finite callback forwarding through JSX spreads in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.eventBindings[0]?.complete).toBe(true);
    expect(report.graph.eventBindings[0]?.callbackIds).toHaveLength(1);
  });

  it("applies later JSX attributes as callback-prop overrides", () => {
    const trailingExplicitReport = proveFixture("proved-jsx-spread-trailing-explicit-event");
    const trailingSpreadReport = proveFixture("proved-jsx-spread-trailing-spread-event");
    const unresolvedSpreadReport = proveFixture("incomplete-jsx-spread-leading-explicit-event");
    const boundaryProof = unresolvedSpreadReport.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(trailingExplicitReport.status).toBe(ReactAppProofStatus.Proved);
    expect(trailingExplicitReport.graph.eventBindings[0]?.complete).toBe(true);
    expect(trailingSpreadReport.status).toBe(ReactAppProofStatus.Proved);
    expect(trailingSpreadReport.graph.eventBindings[0]?.complete).toBe(true);
    expect(unresolvedSpreadReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(unresolvedSpreadReport.graph.eventBindings[0]?.complete).toBe(false);
    expect(boundaryProof?.evidence[0]?.description).toMatch(/JSX spread/);
  });

  it("fails closed for an open-ended intrinsic JSX spread", () => {
    const report = proveFixture("incomplete-jsx-spread-open-ended-event");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.eventBindings[0]?.complete).toBe(false);
    expect(
      boundaryProof?.evidence.some((evidence) =>
        evidence.description.includes("open-ended property set"),
      ),
    ).toBe(true);
  });

  it("fails closed when a source-resolved JSX spread object is mutated", () => {
    const report = proveFixture("incomplete-jsx-spread-mutated-object");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.eventBindings[0]?.complete).toBe(false);
    expect(
      boundaryProof?.evidence.some((evidence) =>
        evidence.description.includes("immutable finite object proof"),
      ),
    ).toBe(true);
  });

  it.each([
    "incomplete-object-callback-spread",
    "incomplete-local-object-callback-spread",
    "incomplete-defaulted-event-prop-wrapper",
    "incomplete-computed-event-prop-wrapper",
    "incomplete-ref-backed-event-callback",
    "incomplete-mutable-object-callback",
    "incomplete-logical-callback-alias",
    "incomplete-partial-handler-factory",
    "incomplete-switch-fallthrough-handler-factory",
    "incomplete-switch-uncovered-handler-factory",
    "incomplete-try-catch-handler-factory",
    "incomplete-while-handler-factory",
    "incomplete-for-of-spread-handler-factory",
    "incomplete-for-of-mutable-handler",
    "incomplete-for-of-defaulted-handler",
    "incomplete-for-of-rest-binding-handler",
    "incomplete-for-of-computed-binding-handler",
  ])("fails closed for unsupported callable value flow in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(boundaryProof).toBeDefined();
  });

  it("requires a temporal proof before invoking a ref-backed callback wrapper", () => {
    const report = proveFixture("incomplete-ref-backed-event-callback");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.evidence.some((evidence) => /temporal freshness/.test(evidence.description)),
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(boundaryProof).toBeDefined();
  });

  it("proves a non-escaping callable ref synchronized before an intrinsic event", () => {
    const report = proveFixture("proved-layout-ref-backed-event-callback");
    const callableRef = report.graph.callableRefs[0];
    const refCall = report.graph.functionCalls.find(
      (functionCall) =>
        functionCall.phase === ReactExecutionPhase.Event &&
        functionCall.sourcePropertyPath.at(-1) === "current",
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(callableRef?.freshness).toBe(ReactCallableRefFreshness.EventSynchronized);
    expect(callableRef?.complete).toBe(true);
    expect(callableRef?.invocationCallIds).toHaveLength(1);
    expect(callableRef?.invocationCallbackIds).toHaveLength(1);
    expect(callableRef?.invocationLocations).toHaveLength(1);
    expect(refCall).toBeDefined();
  });

  it("rejects a callable-ref certificate without its layout synchronization fact", () => {
    const report = proveFixture("proved-layout-ref-backed-event-callback");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callableRefs: report.graph.callableRefs.map((callableRef) => ({
          ...callableRef,
          updateHookName: "useEffect",
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("layout-synchronized event certificate"),
      ),
    ).toBe(true);
  });

  it("rejects a callable-ref certificate without its invocation call edge", () => {
    const report = proveFixture("proved-layout-ref-backed-event-callback");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callableRefs: report.graph.callableRefs.map((callableRef) => ({
          ...callableRef,
          invocationCallIds: ["missing-call"],
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("unknown invocation call"),
      ),
    ).toBe(true);
  });

  it("records the post-commit lag of a passive callable-ref update", () => {
    const report = proveFixture("incomplete-ref-backed-event-callback");
    const callableRef = report.graph.callableRefs[0];
    const freshnessProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.CallableRefFreshness &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(callableRef?.freshness).toBe(ReactCallableRefFreshness.PassiveLag);
    expect(callableRef?.complete).toBe(false);
    expect(freshnessProof?.evidence[0]?.description).toMatch(/passive Effect/);
  });

  it("proves the layout-synchronized useMemo wrapper used by component libraries", () => {
    const report = proveFixture("proved-layout-ref-backed-memo-event-callback");

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.callableRefs[0]?.complete).toBe(true);
    expect(
      report.graph.functionCalls.some(
        (functionCall) =>
          functionCall.phase === ReactExecutionPhase.Event &&
          functionCall.sourcePropertyPath.at(-1) === "current",
      ),
    ).toBe(true);
  });

  it.each([
    "incomplete-layout-ref-escaped-event-callback",
    "incomplete-layout-ref-multiple-write-event-callback",
  ])("fails closed when the callable ref protocol is not exclusive in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const freshnessProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.CallableRefFreshness &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.callableRefs[0]?.sourceComplete).toBe(false);
    expect(freshnessProof).toBeDefined();
  });

  it("requires SSA evidence after mutating a callable object property", () => {
    const report = proveFixture("incomplete-mutable-object-callback");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.evidence.some((evidence) => /SSA value proof/.test(evidence.description)),
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(boundaryProof).toBeDefined();
  });

  it("tracks a callback through a logical alias into an opaque registry", () => {
    const report = proveFixture("incomplete-logical-callback-alias");
    const boundaryProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.BoundaryCoverage &&
          obligation.evidence.some((evidence) =>
            /unmodeled callable-value boundary/.test(evidence.description),
          ),
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(boundaryProof).toBeDefined();
  });

  it.each([
    ["proved-effect-callback-prop", ReactExecutionPhase.EffectSetup],
    ["proved-mixed-phase-callback-prop", ReactExecutionPhase.EffectSetup],
    ["proved-cleanup-callback-prop", ReactExecutionPhase.EffectCleanup],
  ])("proves the callback prop channel used by %s", (fixtureName, expectedPhase) => {
    const report = proveFixture(fixtureName);
    const callbackPropFlow = report.graph.callbackPropFlows.find(
      (propFlow) => propFlow.phase === expectedPhase,
    );
    const phaseCall = report.graph.functionCalls.find(
      (functionCall) =>
        functionCall.phase === expectedPhase &&
        callbackPropFlow?.targetOwnerId === functionCall.ownerId,
    );
    const boundaryProofs = report.units.flatMap((unit) =>
      unit.obligations.filter(
        (obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage,
      ),
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(callbackPropFlow?.complete).toBe(true);
    expect(callbackPropFlow?.callbackIds).toHaveLength(1);
    expect(phaseCall).toBeDefined();
    expect(
      boundaryProofs.every((obligation) => obligation.status === ReactObligationStatus.Proved),
    ).toBe(true);
  });

  it("does not prove a callback-prop Effect cycle through parent state", () => {
    const report = proveFixture("incomplete-effect-callback-prop-state-cycle");
    const transitionProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.EffectStateUpdates &&
          obligation.evidence.some((evidence) =>
            evidence.description.includes("cross-component rerender fixpoint proof"),
          ),
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("records external-store helpers while failing closed on an unmodeled protocol", () => {
    const report = proveFixture("external-store-helper-boundary");
    const subscriptionHelper = report.graph.reachableFunctions.find(
      (reachableFunction) => reachableFunction.name === "addListener",
    );
    const consistencyProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ExternalStoreConsistency);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(subscriptionHelper?.phase).toBe(ReactExecutionPhase.ExternalStoreSubscription);
    expect(consistencyProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("allows conditional use while keeping its lifecycle model incomplete", () => {
    const report = proveFixture("conditional-use");
    const hookOrderProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.HookOrder);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(hookOrderProof?.status).toBe(ReactObligationStatus.Proved);
  });

  it("fails closed when an index key cannot preserve state across reordering", () => {
    const report = proveFixture("index-list-key");
    const reconciliationProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ReconciliationIdentity);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(reconciliationProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(reconciliationProof?.evidence[0]?.description).toMatch(/index key/);
  });

  it("recognizes the React Datepicker loop-index key pattern", () => {
    const report = proveFixture("datepicker-loop-index-key");
    const reconciliationProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.ReconciliationIdentity);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(reconciliationProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(reconciliationProof?.evidence[0]?.description).toMatch(/loop-index-derived key/);
  });

  it("fails closed instead of path-insensitively approving conditional cleanup", () => {
    const report = proveFixture("path-dependent-cleanup");
    const cleanupProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.EffectCleanup);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(cleanupProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(cleanupProof?.evidence[0]?.description).toMatch(/path-dependent/);
  });

  it("proves a render-only class through symbol-resolved React inheritance", () => {
    const report = proveFixture("class-component");
    const renderCallback = report.graph.callbacks.find(
      (callback) => callback.kind === ReactSemanticCallbackKind.ComponentRender,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.units[0]?.kind).toBe("class-component");
    expect(report.graph.units[0]?.classComponentBase).toBe(ReactClassComponentBase.Component);
    expect(report.graph.units[0]?.sourceComplete).toBe(true);
    expect(renderCallback?.phase).toBe(ReactExecutionPhase.Render);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("certifies a prop-history guard as a bounded class update transition", () => {
    const report = proveFixture("proved-class-prop-transition");
    const lifecycle = report.graph.classLifecycles[0];
    const transition = report.graph.classStateTransitions[0];
    const updateCallback = report.graph.callbacks.find(
      (callback) => callback.id === lifecycle?.updateCallbackId,
    );
    const transitionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassStateTransitions,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(transition?.phase).toBe(ReactExecutionPhase.ClassUpdate);
    expect(transition?.updaterStatus).toBe(ReactClassStateUpdaterStatus.Object);
    expect(transition?.cycleStatus).toBe(ReactClassUpdateCycleStatus.Bounded);
    expect(transition?.guardLocations).toHaveLength(1);
    expect(transition?.complete).toBe(true);
    expect(lifecycle?.transitionIds).toEqual([transition?.id]);
    expect(updateCallback?.kind).toBe(ReactSemanticCallbackKind.ClassUpdate);
    expect(updateCallback?.phase).toBe(ReactExecutionPhase.ClassUpdate);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("certifies a pure setState updater in the state-transition phase", () => {
    const report = proveFixture("proved-class-pure-state-updater");
    const transition = report.graph.classStateTransitions[0];
    const updaterCallback = report.graph.callbacks.find(
      (callback) => callback.id === transition?.updaterCallbackId,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(transition?.phase).toBe(ReactExecutionPhase.ClassMount);
    expect(transition?.updaterStatus).toBe(ReactClassStateUpdaterStatus.Pure);
    expect(transition?.cycleStatus).toBe(ReactClassUpdateCycleStatus.None);
    expect(updaterCallback?.kind).toBe(ReactSemanticCallbackKind.ClassStateUpdater);
    expect(updaterCallback?.phase).toBe(ReactExecutionPhase.StateTransition);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes direct class state mutation in every commit lifecycle phase", () => {
    const mountReport = proveFixture("class-direct-state-mutation");
    const updateReport = proveFixture("class-state-mutating-call");
    const unmountReport = proveFixture("class-unmount-state-mutation");
    const mountWrite = mountReport.graph.classStateWrites[0];
    const updateWrite = updateReport.graph.classStateWrites[0];
    const unmountWrite = unmountReport.graph.classStateWrites[0];

    expect(mountWrite?.phase).toBe(ReactExecutionPhase.ClassMount);
    expect(mountWrite?.kind).toBe(ReactClassStateWriteKind.Assignment);
    expect(updateWrite?.phase).toBe(ReactExecutionPhase.ClassUpdate);
    expect(updateWrite?.kind).toBe(ReactClassStateWriteKind.MutatingCall);
    expect(unmountWrite?.phase).toBe(ReactExecutionPhase.ClassUnmount);
    expect(unmountWrite?.kind).toBe(ReactClassStateWriteKind.Assignment);
    for (const [report, stateWrite] of [
      [mountReport, mountWrite],
      [updateReport, updateWrite],
      [unmountReport, unmountWrite],
    ] as const) {
      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(stateWrite?.status).toBe(ReactClassStateWriteStatus.Forbidden);
      expect(stateWrite?.sourceComplete).toBe(true);
      expect(stateWrite?.complete).toBe(false);
      expect(report.graph.classLifecycles[0]?.stateWriteIds).toEqual([stateWrite?.id]);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    }
  });

  it.each(["incomplete-class-state-alias", "incomplete-class-conditional-state-alias"])(
    "fails closed when an object-valued class state reference escapes in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const stateWrite = report.graph.classStateWrites[0];
      const transitionProof = report.units[0]?.obligations.find(
        (obligation) => obligation.claim === ReactProofClaim.ClassStateTransitions,
      );

      expect(report.status).toBe(ReactAppProofStatus.Incomplete);
      expect(stateWrite?.kind).toBe(ReactClassStateWriteKind.ReferenceEscape);
      expect(stateWrite?.status).toBe(ReactClassStateWriteStatus.Unknown);
      expect(stateWrite?.sourceComplete).toBe(false);
      expect(transitionProof?.status).toBe(ReactObligationStatus.Unknown);
      expect(transitionProof?.evidence[0]?.description).toMatch(/ownership boundary/);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("classifies assignment, update, delete, and platform mutator state writes", () => {
    const report = proveFixture("class-state-mutation-forms");

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(report.graph.classStateWrites.map((stateWrite) => stateWrite.kind)).toEqual([
      ReactClassStateWriteKind.Assignment,
      ReactClassStateWriteKind.Update,
      ReactClassStateWriteKind.Delete,
      ReactClassStateWriteKind.MutatingCall,
      ReactClassStateWriteKind.MutatingCall,
      ReactClassStateWriteKind.MutatingCall,
    ]);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes a direct state write reached through a certified deferred class callback", () => {
    const report = proveFixture("class-deferred-state-mutation");
    const stateWrite = report.graph.classStateWrites[0];
    const callback = report.graph.callbacks.find(
      (candidate) => candidate.id === stateWrite?.callbackId,
    );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(stateWrite?.phase).toBe(ReactExecutionPhase.Deferred);
    expect(stateWrite?.kind).toBe(ReactClassStateWriteKind.Assignment);
    expect(callback?.kind).toBe(ReactSemanticCallbackKind.ResourceCallback);
    expect(report.graph.classLifecycles[0]?.stateWriteIds).toEqual([stateWrite?.id]);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("does not call a user-defined persistent push method a direct mutation", () => {
    const report = proveFixture("incomplete-class-custom-push");

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.classStateWrites).toEqual([]);
    expect(report.graph.classLifecycles[0]?.sourceComplete).toBe(false);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a class state ownership certificate that marks a forbidden write complete", () => {
    const report = proveFixture("class-direct-state-mutation");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classStateWrites: report.graph.classStateWrites.map((stateWrite) => ({
          ...stateWrite,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("class state write is complete"),
      ),
    ).toBe(true);
  });

  it("fails closed on PureComponent convergence, commit callbacks, and destructured guards", () => {
    const pureComponentReport = proveFixture("incomplete-pure-component-update");
    const commitCallbackReport = proveFixture("incomplete-class-update-callback");
    const destructuredGuardReport = proveFixture("incomplete-class-destructured-prop-transition");
    const nestedGuardReport = proveFixture("incomplete-class-nested-prop-transition");
    const numberGuardReport = proveFixture("incomplete-class-number-prop-transition");
    const opaqueUpdaterReport = proveFixture("incomplete-class-opaque-state-updater");

    expect(pureComponentReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(pureComponentReport.graph.units[0]?.classComponentBase).toBe(
      ReactClassComponentBase.PureComponent,
    );
    expect(pureComponentReport.graph.classStateTransitions[0]?.cycleStatus).toBe(
      ReactClassUpdateCycleStatus.Unknown,
    );
    expect(commitCallbackReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(commitCallbackReport.graph.classStateTransitions[0]?.commitCallbackProvided).toBe(true);
    expect(commitCallbackReport.graph.classStateTransitions[0]?.sourceComplete).toBe(false);
    expect(destructuredGuardReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(destructuredGuardReport.graph.classStateTransitions[0]?.cycleStatus).toBe(
      ReactClassUpdateCycleStatus.Unknown,
    );
    expect(nestedGuardReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(nestedGuardReport.graph.classStateTransitions[0]?.cycleStatus).toBe(
      ReactClassUpdateCycleStatus.Unknown,
    );
    expect(numberGuardReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(numberGuardReport.graph.classStateTransitions[0]?.cycleStatus).toBe(
      ReactClassUpdateCycleStatus.Unknown,
    );
    expect(opaqueUpdaterReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(opaqueUpdaterReport.graph.classStateTransitions[0]?.updaterStatus).toBe(
      ReactClassStateUpdaterStatus.Unknown,
    );
    expect(opaqueUpdaterReport.graph.classStateTransitions[0]?.updaterCallbackId).not.toBeNull();
    expect(checkReactProofReport(opaqueUpdaterReport).status).toBe(
      ReactProofCertificateStatus.Valid,
    );
  });

  it("rejects a class transition certificate with a forged lifecycle link", () => {
    const report = proveFixture("proved-class-prop-transition");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classLifecycles: report.graph.classLifecycles.map((lifecycle) => ({
          ...lifecycle,
          transitionIds: ["forged-transition"],
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("invalid state transition link"),
      ),
    ).toBe(true);
  });

  it("rejects a class transition certificate without its pure updater callback", () => {
    const report = proveFixture("proved-class-pure-state-updater");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classStateTransitions: report.graph.classStateTransitions.map((transition) => ({
          ...transition,
          updaterCallbackId: null,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("invalid updater")),
    ).toBe(true);
  });

  it("rejects a class transition certificate with contradictory guard facts", () => {
    const report = proveFixture("proved-class-prop-transition");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classStateTransitions: report.graph.classStateTransitions.map((transition) => ({
          ...transition,
          cycleStatus: ReactClassUpdateCycleStatus.None,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("invalid guards")),
    ).toBe(true);
  });

  it("certifies a class mount-listener-unmount lifecycle with exact method identity", () => {
    const report = proveFixture("proved-class-listener");
    const lifecycle = report.graph.classLifecycles[0];
    const resource = report.graph.resources[0];
    const mountCallback = report.graph.callbacks.find(
      (callback) => callback.id === lifecycle?.mountCallbackId,
    );
    const unmountCallback = report.graph.callbacks.find(
      (callback) => callback.id === lifecycle?.unmountCallbackId,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(lifecycle?.sourceComplete).toBe(true);
    expect(lifecycle?.complete).toBe(true);
    expect(lifecycle?.resourceIds).toEqual([resource?.id]);
    expect(mountCallback?.kind).toBe(ReactSemanticCallbackKind.ClassMount);
    expect(mountCallback?.phase).toBe(ReactExecutionPhase.ClassMount);
    expect(unmountCallback?.kind).toBe(ReactSemanticCallbackKind.ClassUnmount);
    expect(unmountCallback?.phase).toBe(ReactExecutionPhase.ClassUnmount);
    expect(resource?.effectId).toBeNull();
    expect(resource?.acquisitionCallbackId).toBe(mountCallback?.id);
    expect(resource?.disposalStatus).toBe(ReactEffectResourceDisposalStatus.Guaranteed);
    expect(resource?.complete).toBe(true);
  });

  it("fails closed on mutable class-method identity and unmodeled lifecycle helpers", () => {
    const mutableMethodReport = proveFixture("incomplete-class-listener-method-reassigned");
    const helperReport = proveFixture("incomplete-class-helper-lifecycle");

    expect(mutableMethodReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(mutableMethodReport.graph.resources[0]?.complete).toBe(false);
    expect(mutableMethodReport.graph.classLifecycles[0]?.sourceComplete).toBe(false);
    expect(helperReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(helperReport.graph.resources[0]?.complete).toBe(true);
    expect(helperReport.graph.classLifecycles[0]?.sourceComplete).toBe(false);
  });

  it("rejects a class lifecycle certificate with a forged resource link", () => {
    const report = proveFixture("proved-class-listener");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classLifecycles: report.graph.classLifecycles.map((lifecycle) => ({
          ...lifecycle,
          resourceIds: ["forged-resource"],
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("invalid resource link")),
    ).toBe(true);
  });

  it("certifies a class mount-timeout-unmount lifecycle with an exact handle", () => {
    const report = proveFixture("proved-class-timeout");
    const lifecycle = report.graph.classLifecycles[0];
    const scheduler = report.graph.schedulers[0];
    const mountCallback = report.graph.callbacks.find(
      (callback) => callback.id === lifecycle?.mountCallbackId,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(lifecycle?.sourceComplete).toBe(true);
    expect(lifecycle?.complete).toBe(true);
    expect(lifecycle?.schedulerIds).toEqual([scheduler?.id]);
    expect(scheduler?.effectId).toBeNull();
    expect(scheduler?.registrationCallbackId).toBe(mountCallback?.id);
    expect(scheduler?.kind).toBe(ReactSchedulerKind.Timeout);
    expect(scheduler?.cancellationStatus).toBe(ReactSchedulerCancellationStatus.Guaranteed);
    expect(scheduler?.complete).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("fails closed when a class scheduler handle is reassigned", () => {
    const report = proveFixture("incomplete-class-timeout-reassigned");

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.schedulers[0]?.complete).toBe(false);
    expect(report.graph.schedulers[0]?.cancellationStatus).toBe(
      ReactSchedulerCancellationStatus.Unknown,
    );
    expect(report.graph.classLifecycles[0]?.sourceComplete).toBe(false);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a class lifecycle certificate with a forged scheduler link", () => {
    const report = proveFixture("proved-class-timeout");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classLifecycles: report.graph.classLifecycles.map((lifecycle) => ({
          ...lifecycle,
          schedulerIds: ["forged-scheduler"],
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("invalid scheduler link"),
      ),
    ).toBe(true);
  });

  it("rejects a class unit with its lifecycle certificate removed", () => {
    const report = proveFixture("class-component");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classLifecycles: [],
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("no lifecycle certificate"),
      ),
    ).toBe(true);
  });

  it("refutes an impure class render instead of trusting the class boundary", () => {
    const report = proveFixture("class-render-impurity");
    const renderProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.RenderPurity,
    );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(renderProof?.status).toBe(ReactObligationStatus.Violated);
    expect(renderProof?.evidence[0]?.description).toMatch(/not pure during render/);
  });

  it("fails closed for class fields while certifying an empty update lifecycle", () => {
    const fieldReport = proveFixture("incomplete-class-field");
    const lifecycleReport = proveFixture("incomplete-class-lifecycle");
    const transitionProof = lifecycleReport.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassStateTransitions,
    );

    expect(fieldReport.status).toBe(ReactAppProofStatus.Incomplete);
    expect(fieldReport.graph.units[0]?.sourceComplete).toBe(false);
    expect(lifecycleReport.status).toBe(ReactAppProofStatus.Proved);
    expect(lifecycleReport.graph.units[0]?.sourceComplete).toBe(true);
    expect(lifecycleReport.graph.classLifecycles[0]?.updateCallbackId).not.toBeNull();
    expect(lifecycleReport.graph.classStateTransitions).toEqual([]);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Proved);
  });

  it("does not mistake a shadowed Component base for React inheritance", () => {
    const report = proveFixture("shadowed-component-class");

    expect(report.graph.units).toEqual([]);
  });

  it("fails closed when TypeScript assertions can forge proof facts", () => {
    const report = proveFixture("unsafe-types");

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.projectEvidence[0]?.description).toMatch(/unchecked type assertion/);
  });

  it("fails closed when React Compiler cannot produce proof facts", () => {
    const report = proveFixture("compiler-bailout");

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.compiler.status).toBe(ReactCompilerFactStatus.Incomplete);
    expect(report.projectEvidence[0]?.description).toMatch(/React Compiler/);
    expect(report.graph.compiler.failures[0]?.description).toBeTruthy();
  });

  it("returns an incomplete report instead of throwing when project discovery fails", () => {
    const report = proveReactApp({
      rootDirectory: path.join(fixturesDirectory, "missing-project"),
    });

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.units).toEqual([]);
    expect(report.projectEvidence[0]?.description).toMatch(/No tsconfig/);
  });
});
