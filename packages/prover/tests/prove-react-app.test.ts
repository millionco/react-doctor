import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  checkReactProofReport,
  proveReactApp,
  ReactActionStateDispatchKind,
  ReactActionStateDispatchStatus,
  ReactActionStateReducerStatus,
  ReactAppProofStatus,
  ReactAsyncOwnershipStatus,
  ReactCallableRefFreshness,
  ReactClassComponentBase,
  ReactClassConstructionIssueKind,
  ReactClassConstructionStatus,
  ReactClassStateInitializationKind,
  ReactClassStateInitializationRequirement,
  ReactClassStateUpdaterStatus,
  ReactClassStateWriteKind,
  ReactClassStateWriteStatus,
  ReactClassUpdateCycleStatus,
  ReactCompilerFactStatus,
  ReactEffectDependencyMode,
  ReactEffectResourceDisposalStatus,
  ReactEffectResourceKind,
  ReactErrorBoundaryCoverageStatus,
  ReactErrorBoundaryProtocolStatus,
  ReactExecutionPhase,
  ReactFormActionStatus,
  ReactFormStatusTopologyStatus,
  ReactHostControlKind,
  ReactHostControlStatus,
  ReactHostControlUpdateStatus,
  ReactHostControlValueStatus,
  ReactHookStateUpdaterStatus,
  ReactIdentityStability,
  ReactImperativeHandleRefKind,
  ReactImperativeHandleStatus,
  ReactLazyDeclarationStatus,
  ReactLazyLoaderStatus,
  ReactObligationStatus,
  ReactOptimisticActionStatus,
  ReactOptimisticReducerStatus,
  ReactProofClaim,
  ReactReducerDispatchKind,
  ReactReducerDispatchStatus,
  ReactReducerPurityStatus,
  ReactReducerReturnStatus,
  ReactSchedulerCancellationStatus,
  ReactSchedulerKind,
  ReactProofCertificateStatus,
  ReactSemanticEdgeKind,
  ReactSemanticCallbackKind,
  ReactSemanticFunctionCallKind,
  ReactSemanticRenderKind,
  ReactSuspenseCoverageStatus,
  ReactTransitionActionStatus,
  ReactTransitionStarterKind,
  ReactUseResourceIdentityStatus,
  ReactUseResourceKind,
} from "../src/index.js";

interface RefutedFixtureExpectation {
  fixtureName: string;
  claim: ReactProofClaim;
  evidencePattern: RegExp;
}

interface ClassConstructionIssueExpectation {
  fixtureName: string;
  issueKind: ReactClassConstructionIssueKind;
}

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const proveFixture = (fixtureName: string) =>
  proveReactApp({
    rootDirectory: path.join(fixturesDirectory, fixtureName),
  });

const REFUTED_FIXTURES: ReadonlyArray<RefutedFixtureExpectation> = [
  {
    fixtureName: "refuted-stale-imperative-handle",
    claim: ReactProofClaim.ImperativeHandle,
    evidencePattern: /stale reactive values/,
  },
  {
    fixtureName: "refuted-impure-imperative-handle-factory",
    claim: ReactProofClaim.ImperativeHandle,
    evidencePattern: /observable side effect/,
  },
  {
    fixtureName: "refuted-action-state-outside-action",
    claim: ReactProofClaim.ActionState,
    evidencePattern: /outside an Action/,
  },
  {
    fixtureName: "refuted-action-state-render-dispatch",
    claim: ReactProofClaim.ActionState,
    evidencePattern: /during render/,
  },
  {
    fixtureName: "refuted-unsupported-form-action-control",
    claim: ReactProofClaim.FormActions,
    evidencePattern: /cannot invoke/,
  },
  {
    fixtureName: "refuted-form-status-outside-form",
    claim: ReactProofClaim.FormStatus,
    evidencePattern: /without a parent <form>/,
  },
  {
    fixtureName: "refuted-form-status-same-component",
    claim: ReactProofClaim.FormStatus,
    evidencePattern: /without a parent <form>/,
  },
  {
    fixtureName: "refuted-form-status-mixed-placement",
    claim: ReactProofClaim.FormStatus,
    evidencePattern: /without a parent <form>/,
  },
  {
    fixtureName: "refuted-form-status-exported-child",
    claim: ReactProofClaim.FormStatus,
    evidencePattern: /without a parent <form>/,
  },
  {
    fixtureName: "refuted-form-status-mixed-slot-placement",
    claim: ReactProofClaim.FormStatus,
    evidencePattern: /without a parent <form>/,
  },
  {
    fixtureName: "refuted-optimistic-outside-action",
    claim: ReactProofClaim.OptimisticState,
    evidencePattern: /outside a Transition or Form Action/,
  },
  {
    fixtureName: "refuted-optimistic-render-update",
    claim: ReactProofClaim.OptimisticState,
    evidencePattern: /during render/,
  },
  {
    fixtureName: "refuted-impure-optimistic-reducer",
    claim: ReactProofClaim.OptimisticState,
    evidencePattern: /impure optimistic reducer/,
  },
  {
    fixtureName: "refuted-impure-optimistic-updater",
    claim: ReactProofClaim.OptimisticState,
    evidencePattern: /observable side effect/,
  },
  {
    fixtureName: "refuted-mixed-optimistic-action-roots",
    claim: ReactProofClaim.OptimisticState,
    evidencePattern: /outside a Transition or Form Action/,
  },
  {
    fixtureName: "refuted-transition-controlled-input",
    claim: ReactProofClaim.TransitionActions,
    evidencePattern: /updates controlled input state/,
  },
  {
    fixtureName: "refuted-transition-derived-controlled-input",
    claim: ReactProofClaim.TransitionActions,
    evidencePattern: /updates controlled input state/,
  },
  {
    fixtureName: "refuted-impure-hook-state-updater",
    claim: ReactProofClaim.HookStateTransitions,
    evidencePattern: /observable side effect/,
  },
  {
    fixtureName: "refuted-class-invalid-state",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /not an object/,
  },
  {
    fixtureName: "refuted-class-constructor-side-effect",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /observable or non-idempotent/,
  },
  {
    fixtureName: "refuted-class-constructor-subscription",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /observable or non-idempotent/,
  },
  {
    fixtureName: "refuted-class-field-side-effect",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /observable or non-idempotent/,
  },
  {
    fixtureName: "refuted-class-constructor-order",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /super with its props before/,
  },
  {
    fixtureName: "refuted-class-constructor-set-state",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /calls setState/,
  },
  {
    fixtureName: "refuted-class-missing-state",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /without a proved initialization/,
  },
  {
    fixtureName: "refuted-class-missing-updater-state",
    claim: ReactProofClaim.ClassConstruction,
    evidencePattern: /without a proved initialization/,
  },
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
    fixtureName: "reducer-fallthrough",
    claim: ReactProofClaim.ReducerTransitions,
    evidencePattern: /without returning state/,
  },
  {
    fixtureName: "reducer-throw",
    claim: ReactProofClaim.ReducerTransitions,
    evidencePattern: /throw instead of returning state/,
  },
  {
    fixtureName: "reducer-render-dispatch",
    claim: ReactProofClaim.ReducerTransitions,
    evidencePattern: /executes during render/,
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
    "proved-reducer-dispatch-only",
    "proved-reducer-lazy-initializer",
    "proved-context",
    "proved-wrapped-component",
    "proved-null-component",
    "proved-default-component",
    "proved-aliased-hook",
    "proved-static-list-keys",
    "proved-mount-state-update",
    "proved-hook-functional-updater",
    "proved-hook-direct-state-value",
    "proved-effect-functional-updater",
    "proved-state-setter-lookalikes",
    "proved-imperative-handle",
    "proved-forward-ref-imperative-handle",
    "proved-transition-tabs",
    "proved-use-transition-action",
    "proved-transition-lookalike",
    "proved-optimistic-form",
    "proved-form-action-submitter",
    "proved-helper-spread-form-action",
    "proved-optimistic-transition-updater",
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
    "proved-class-state-field",
    "proved-class-field-from-props",
    "proved-class-constructor-state",
    "proved-class-constructor-binding",
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

    expect(report.schemaVersion).toBe(28);
    expect(report.graph.schemaVersion).toBe(34);
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

  it("certifies a React 19 ref-prop handle through its exact event invocation", () => {
    const report = proveFixture("proved-imperative-handle");
    const handle = report.graph.imperativeHandles[0];
    const binding = report.graph.imperativeHandleBindings[0];
    const invocation = report.graph.imperativeHandleInvocations[0];
    const methodCallback = report.graph.callbacks.find(
      (callback) => callback.id === invocation?.methodCallbackIds[0],
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(handle?.refKind).toBe(ReactImperativeHandleRefKind.RefProp);
    expect(handle?.status).toBe(ReactImperativeHandleStatus.Resolved);
    expect(handle?.methodIds).toHaveLength(2);
    expect(handle?.bindingIds).toEqual([binding?.id]);
    expect(handle?.sourceComplete).toBe(true);
    expect(handle?.complete).toBe(true);
    expect(binding?.invocationIds).toEqual([invocation?.id]);
    expect(binding?.complete).toBe(true);
    expect(invocation?.callerCallbackIds).toHaveLength(1);
    expect(invocation?.methodCallbackIds).toHaveLength(1);
    expect(invocation?.complete).toBe(true);
    expect(methodCallback?.kind).toBe(ReactSemanticCallbackKind.ImperativeHandleMethod);
    expect(methodCallback?.phase).toBe(ReactExecutionPhase.Event);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("preserves the caller Effect phase through a forwardRef handle method", () => {
    const report = proveFixture("proved-forward-ref-imperative-handle");
    const handle = report.graph.imperativeHandles[0];
    const invocation = report.graph.imperativeHandleInvocations[0];
    const methodCallback = report.graph.callbacks.find(
      (callback) => callback.id === invocation?.methodCallbackIds[0],
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(handle?.refKind).toBe(ReactImperativeHandleRefKind.ForwardedRef);
    expect(handle?.dependencyMode).toBe(ReactEffectDependencyMode.Inline);
    expect(handle?.complete).toBe(true);
    expect(methodCallback?.phase).toBe(ReactExecutionPhase.EffectSetup);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each([
    "incomplete-exported-imperative-handle",
    "incomplete-opaque-imperative-handle",
    "incomplete-callback-ref-imperative-handle",
    "incomplete-computed-imperative-handle-method",
    "incomplete-escaped-imperative-handle-ref",
    "incomplete-reused-imperative-handle-target",
    "incomplete-shared-imperative-handle-ref",
  ])("fails closed for an open imperative handle protocol in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const handle = report.graph.imperativeHandles[0];
    const handleProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ImperativeHandle &&
          obligation.status === ReactObligationStatus.Unknown,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(handle?.complete).toBe(false);
    expect(handleProof).toBeDefined();
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged imperative handle completeness certificate", () => {
    const report = proveFixture("proved-imperative-handle");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        imperativeHandles: report.graph.imperativeHandles.map((handle) => ({
          ...handle,
          complete: false,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("imperative handle completeness"),
      ),
    ).toBe(true);
  });

  it("rejects a forged imperative handle factory-purity status", () => {
    const report = proveFixture("refuted-impure-imperative-handle-factory");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        imperativeHandles: report.graph.imperativeHandles.map((handle) => ({
          ...handle,
          status: ReactImperativeHandleStatus.Resolved,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("factory purity")),
    ).toBe(true);
  });

  it("rejects a handle invocation linked to a different method body", () => {
    const report = proveFixture("proved-imperative-handle");
    const invocation = report.graph.imperativeHandleInvocations[0];
    const methodCallbackId = invocation?.methodCallbackIds[0];
    const otherMethod = report.graph.imperativeHandleMethods.find(
      (method) => method.id !== invocation?.methodId,
    );
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        callbacks: report.graph.callbacks.map((callback) =>
          callback.id === methodCallbackId && otherMethod
            ? { ...callback, location: otherMethod.location }
            : callback,
        ),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("invalid method callback"),
      ),
    ).toBe(true);
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

  it("certifies a total typed reducer, lazy initializer, and event dispatch", () => {
    const report = proveFixture("proved-reducer-lazy-initializer");
    const reducer = report.graph.reducers[0];
    const dispatch = report.graph.reducerDispatches[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(reducer?.reducerPurity).toBe(ReactReducerPurityStatus.Pure);
    expect(reducer?.initializerPurity).toBe(ReactReducerPurityStatus.Pure);
    expect(reducer?.reducerReturnStatus).toBe(ReactReducerReturnStatus.Total);
    expect(reducer?.initializerReturnStatus).toBe(ReactReducerReturnStatus.Total);
    expect(reducer?.complete).toBe(true);
    expect(dispatch?.kind).toBe(ReactReducerDispatchKind.Call);
    expect(dispatch?.status).toBe(ReactReducerDispatchStatus.Owned);
    expect(dispatch?.complete).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("certifies an omitted reducer state binding and stable dispatcher dependency", () => {
    const report = proveFixture("proved-reducer-dispatch-only");
    const reducer = report.graph.reducers[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(reducer?.stateName).toBe("unused reducer state");
    expect(reducer?.dispatcherName).toBe("forceRender");
    expect(report.graph.reducerDispatches).toHaveLength(1);
    expect(report.graph.reducerDispatches[0]?.status).toBe(ReactReducerDispatchStatus.Owned);
  });

  it.each(["reducer-dispatch-escape", "opaque-reducer-wrapper"])(
    "fails closed for an open reducer transition protocol in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const reducerProof = report.units
        .flatMap((unit) => unit.obligations)
        .find((obligation) => obligation.claim === ReactProofClaim.ReducerTransitions);

      expect(report.status).toBe(ReactAppProofStatus.Incomplete);
      expect(reducerProof?.status).toBe(ReactObligationStatus.Unknown);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("rejects forged reducer totality", () => {
    const report = proveFixture("reducer-fallthrough");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        reducers: report.graph.reducers.map((reducer) => ({
          ...reducer,
          reducerReturnStatus: ReactReducerReturnStatus.Total,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("Reducer transition facts require"),
      ),
    ).toBe(true);
  });

  it("rejects forged reducer dispatch ownership", () => {
    const report = proveFixture("reducer-render-dispatch");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        reducerDispatches: report.graph.reducerDispatches.map((dispatch) => ({
          ...dispatch,
          status: ReactReducerDispatchStatus.Owned,
          sourceComplete: true,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("reducer dispatch status"),
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
    "proved-reducer-lazy-initializer",
    "proved-reducer-dispatch-only",
    "reducer-fallthrough",
    "reducer-throw",
    "reducer-render-dispatch",
    "reducer-dispatch-escape",
    "opaque-reducer-wrapper",
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

  it("allows conditional use while refuting missing pending and rejection containment", () => {
    const report = proveFixture("conditional-use");
    const hookOrderProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.HookOrder);
    const resourceProof = report.units
      .flatMap((unit) => unit.obligations)
      .find((obligation) => obligation.claim === ReactProofClaim.UseResource);

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(hookOrderProof?.status).toBe(ReactObligationStatus.Proved);
    expect(resourceProof?.status).toBe(ReactObligationStatus.Violated);
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

  it("certifies public-field state construction and an empty update lifecycle", () => {
    const fieldReport = proveFixture("proved-class-state-field");
    const lifecycleReport = proveFixture("incomplete-class-lifecycle");
    const transitionProof = lifecycleReport.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassStateTransitions,
    );

    expect(fieldReport.status).toBe(ReactAppProofStatus.Proved);
    expect(fieldReport.graph.units[0]?.sourceComplete).toBe(true);
    expect(fieldReport.graph.classConstructions[0]?.initializationKind).toBe(
      ReactClassStateInitializationKind.PublicField,
    );
    expect(fieldReport.graph.classConstructions[0]?.stateRequirement).toBe(
      ReactClassStateInitializationRequirement.Required,
    );
    expect(fieldReport.graph.classConstructions[0]?.status).toBe(
      ReactClassConstructionStatus.Valid,
    );
    expect(lifecycleReport.status).toBe(ReactAppProofStatus.Proved);
    expect(lifecycleReport.graph.units[0]?.sourceComplete).toBe(true);
    expect(lifecycleReport.graph.classLifecycles[0]?.updateCallbackId).not.toBeNull();
    expect(lifecycleReport.graph.classStateTransitions).toEqual([]);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Proved);
  });

  it.each(["proved-class-constructor-state", "proved-class-constructor-binding"])(
    "certifies canonical constructor state and method binding in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const construction = report.graph.classConstructions[0];
      const constructionProof = report.units[0]?.obligations.find(
        (obligation) => obligation.claim === ReactProofClaim.ClassConstruction,
      );

      expect(report.status).toBe(ReactAppProofStatus.Proved);
      expect(construction?.phase).toBe(ReactExecutionPhase.ClassConstruction);
      expect(construction?.constructorLocation).not.toBeNull();
      expect(construction?.initializationKind).toBe(
        ReactClassStateInitializationKind.ConstructorAssignment,
      );
      expect(construction?.stateRequirement).toBe(
        ReactClassStateInitializationRequirement.Required,
      );
      expect(construction?.issues).toEqual([]);
      expect(construction?.status).toBe(ReactClassConstructionStatus.Valid);
      expect(construction?.sourceComplete).toBe(true);
      expect(construction?.complete).toBe(true);
      expect(report.graph.classLifecycles[0]?.constructionId).toBe(construction?.id);
      expect(constructionProof?.status).toBe(ReactObligationStatus.Proved);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("certifies a realistic event updater through its reachable helper", () => {
    const report = proveFixture("proved-hook-functional-updater");
    const transition = report.graph.hookStateTransitions[0];
    const updaterCallback = report.graph.callbacks.find(
      (callback) => callback.id === transition?.updaterCallbackId,
    );
    const executionCallbacks = report.graph.callbacks.filter((callback) =>
      transition?.executionCallbackIds.includes(callback.id),
    );
    const transitionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.HookStateTransitions,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(transition?.stateName).toBe("openPaths");
    expect(transition?.setterName).toBe("setOpenPaths");
    expect(transition?.updaterStatus).toBe(ReactHookStateUpdaterStatus.Pure);
    expect(transition?.sourceComplete).toBe(true);
    expect(transition?.complete).toBe(true);
    expect(
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Event),
    ).toBe(true);
    expect(updaterCallback?.kind).toBe(ReactSemanticCallbackKind.HookStateUpdater);
    expect(updaterCallback?.phase).toBe(ReactExecutionPhase.StateTransition);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("separates direct state values and reducer actions from functional state updaters", () => {
    const directReport = proveFixture("proved-hook-direct-state-value");
    const lookalikeReport = proveFixture("proved-state-setter-lookalikes");

    expect(directReport.graph.hookStateTransitions).toHaveLength(2);
    expect(
      directReport.graph.hookStateTransitions.every(
        (transition) => transition.updaterStatus === ReactHookStateUpdaterStatus.DirectValue,
      ),
    ).toBe(true);
    expect(
      directReport.graph.hookStateTransitions.every(
        (transition) => transition.updaterCallbackId === null,
      ),
    ).toBe(true);
    expect(lookalikeReport.graph.hookStateTransitions).toHaveLength(1);
    expect(lookalikeReport.graph.hookStateTransitions[0]?.setterName).toBe("updateCount");
    expect(lookalikeReport.graph.hookStateTransitions[0]?.updaterStatus).toBe(
      ReactHookStateUpdaterStatus.DirectValue,
    );
  });

  it("roots a functional state updater in an Effect setup callback", () => {
    const report = proveFixture("proved-effect-functional-updater");
    const transition = report.graph.hookStateTransitions[0];
    const executionCallbacks = report.graph.callbacks.filter((callback) =>
      transition?.executionCallbackIds.includes(callback.id),
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(transition?.updaterStatus).toBe(ReactHookStateUpdaterStatus.Pure);
    expect(
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.EffectSetup),
    ).toBe(true);
  });

  it.each([
    ["incomplete-opaque-hook-state-updater", ReactHookStateUpdaterStatus.Unknown],
    ["incomplete-hook-state-setter-escape", ReactHookStateUpdaterStatus.SetterEscape],
    ["incomplete-hook-setter-in-reducer", ReactHookStateUpdaterStatus.Pure],
  ])("fails closed for unresolved Hook state flow in %s", (fixtureName, updaterStatus) => {
    const report = proveFixture(fixtureName);
    const transition = report.graph.hookStateTransitions.find(
      (candidate) => candidate.updaterStatus === updaterStatus,
    );
    const transitionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.HookStateTransitions,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(transition?.sourceComplete).toBe(false);
    expect(transition?.complete).toBe(false);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged Hook state transition certificate", () => {
    const report = proveFixture("incomplete-opaque-hook-state-updater");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        hookStateTransitions: report.graph.hookStateTransitions.map((transition) => ({
          ...transition,
          sourceComplete: true,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("Hook state transition")),
    ).toBe(true);
  });

  it("certifies a realistic global Transition Action and its state update", () => {
    const report = proveFixture("proved-transition-tabs");
    const action = report.graph.transitionActions[0];
    const actionCallback = report.graph.callbacks.find(
      (callback) => callback.id === action?.actionCallbackId,
    );
    const executionCallbacks = report.graph.callbacks.filter((callback) =>
      action?.executionCallbackIds.includes(callback.id),
    );
    const hookTransition = report.graph.hookStateTransitions[0];
    const transitionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.TransitionActions,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(action?.starterKind).toBe(ReactTransitionStarterKind.Global);
    expect(action?.status).toBe(ReactTransitionActionStatus.Synchronous);
    expect(action?.controlledStateNames).toEqual([]);
    expect(action?.unknownControlStateNames).toEqual([]);
    expect(action?.sourceComplete).toBe(true);
    expect(action?.complete).toBe(true);
    expect(actionCallback?.kind).toBe(ReactSemanticCallbackKind.TransitionAction);
    expect(actionCallback?.phase).toBe(ReactExecutionPhase.TransitionAction);
    expect(
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Event),
    ).toBe(true);
    expect(hookTransition?.executionCallbackIds).toContain(action?.actionCallbackId);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("certifies a useTransition starter without confusing a user lookalike", () => {
    const hookReport = proveFixture("proved-use-transition-action");
    const lookalikeReport = proveFixture("proved-transition-lookalike");

    expect(hookReport.status).toBe(ReactAppProofStatus.Proved);
    expect(hookReport.graph.transitionActions).toHaveLength(1);
    expect(hookReport.graph.transitionActions[0]?.starterKind).toBe(
      ReactTransitionStarterKind.Hook,
    );
    expect(hookReport.graph.transitionActions[0]?.complete).toBe(true);
    expect(lookalikeReport.status).toBe(ReactAppProofStatus.Proved);
    expect(lookalikeReport.graph.transitionActions).toEqual([]);
  });

  it("refutes a Transition update to direct controlled input state", () => {
    const report = proveFixture("refuted-transition-controlled-input");
    const action = report.graph.transitionActions[0];
    const transitionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.TransitionActions,
    );

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(action?.status).toBe(ReactTransitionActionStatus.ControlledInput);
    expect(action?.controlledStateNames).toEqual(["query"]);
    expect(action?.sourceComplete).toBe(true);
    expect(action?.complete).toBe(false);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Violated);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("tracks a controlled input through an immutable derived alias", () => {
    const report = proveFixture("refuted-transition-derived-controlled-input");

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(report.graph.transitionActions[0]?.status).toBe(
      ReactTransitionActionStatus.ControlledInput,
    );
    expect(report.graph.transitionActions[0]?.controlledStateNames).toEqual(["query"]);
  });

  it.each([
    ["incomplete-async-transition-action", ReactTransitionActionStatus.Async],
    ["incomplete-opaque-transition-action", ReactTransitionActionStatus.Opaque],
    ["incomplete-transition-starter-escape", ReactTransitionActionStatus.StarterEscape],
    ["incomplete-transition-control-prop", ReactTransitionActionStatus.UnknownControl],
  ])("fails closed for incomplete Transition semantics in %s", (fixtureName, expectedStatus) => {
    const report = proveFixture(fixtureName);
    const action = report.graph.transitionActions.find(
      (candidate) => candidate.status === expectedStatus,
    );
    const actionOwner = report.graph.units.find((unit) => unit.id === action?.ownerId);
    const transitionProof = report.units
      .find(
        (unit) =>
          unit.name === actionOwner?.name &&
          unit.location.filePath === actionOwner.location.filePath &&
          unit.location.line === actionOwner.location.line &&
          unit.location.column === actionOwner.location.column,
      )
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.TransitionActions);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(action?.sourceComplete).toBe(false);
    expect(action?.complete).toBe(false);
    expect(transitionProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("keeps indirect useTransition tuple access outside the modeled boundary", () => {
    const report = proveFixture("incomplete-use-transition-tuple");
    const boundaryProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.BoundaryCoverage,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.transitionActions).toEqual([]);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Unknown);
  });

  it("separates an async Action from its nested post-await Transition", () => {
    const report = proveFixture("incomplete-async-transition-action");
    const outerAction = report.graph.transitionActions.find(
      (action) => action.status === ReactTransitionActionStatus.Async,
    );
    const nestedAction = report.graph.transitionActions.find(
      (action) => action.status === ReactTransitionActionStatus.Synchronous,
    );

    expect(outerAction?.complete).toBe(false);
    expect(nestedAction?.complete).toBe(true);
    expect(nestedAction?.executionCallbackIds).toContain(outerAction?.actionCallbackId);
  });

  it("rejects a forged Transition Action certificate", () => {
    const report = proveFixture("incomplete-async-transition-action");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        transitionActions: report.graph.transitionActions.map((action) => ({
          ...action,
          status: ReactTransitionActionStatus.Synchronous,
          sourceComplete: true,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("Transition Action")),
    ).toBe(true);
  });

  it("certifies Action State through direct Form Action and nested Form Action roots", () => {
    const report = proveFixture("proved-action-state-form");
    const actionState = report.graph.actionStates[0];
    const reducerCallback = report.graph.callbacks.find(
      (callback) => callback.id === actionState?.reducerCallbackId,
    );
    const actionStateProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ActionState,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(actionState?.reducerStatus).toBe(ReactActionStateReducerStatus.Resolved);
    expect(actionState?.complete).toBe(true);
    expect(reducerCallback?.kind).toBe(ReactSemanticCallbackKind.ActionStateReducer);
    expect(reducerCallback?.phase).toBe(ReactExecutionPhase.ActionStateReducer);
    expect(report.graph.actionStateDispatches).toHaveLength(2);
    expect(
      report.graph.actionStateDispatches.every(
        (dispatch) =>
          dispatch.status === ReactActionStateDispatchStatus.Action && dispatch.complete,
      ),
    ).toBe(true);
    expect(
      report.graph.actionStateDispatches.some(
        (dispatch) => dispatch.kind === ReactActionStateDispatchKind.ActionProp,
      ),
    ).toBe(true);
    expect(
      report.graph.formActions.some(
        (formAction) =>
          formAction.complete &&
          Boolean(
            actionState?.reducerCallbackId &&
            formAction.actionCallbackIds.includes(actionState.reducerCallbackId),
          ),
      ),
    ).toBe(true);
    expect(actionStateProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("certifies a direct Action State dispatch inside a synchronous Transition Action", () => {
    const report = proveFixture("proved-action-state-transition");
    const dispatch = report.graph.actionStateDispatches[0];
    const transitionAction = report.graph.transitionActions[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(transitionAction?.complete).toBe(true);
    expect(dispatch?.kind).toBe(ReactActionStateDispatchKind.Call);
    expect(dispatch?.status).toBe(ReactActionStateDispatchStatus.Action);
    expect(dispatch?.executionCallbackIds).toContain(transitionAction?.actionCallbackId);
    expect(dispatch?.complete).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each([
    ["incomplete-action-state-dispatcher-escape", ReactActionStateDispatchStatus.SetterEscape],
    ["incomplete-action-state-async-transition", ReactActionStateDispatchStatus.Unknown],
  ])("fails closed for incomplete Action State dispatch ownership in %s", (fixtureName, status) => {
    const report = proveFixture(fixtureName);
    const dispatch = report.graph.actionStateDispatches[0];
    const actionStateProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ActionState,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(dispatch?.status).toBe(status);
    expect(dispatch?.complete).toBe(false);
    expect(actionStateProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("fails closed when the Action State reducer comes from an unresolved prop", () => {
    const report = proveFixture("incomplete-action-state-reducer-prop");
    const actionState = report.graph.actionStates[0];
    const actionStateProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ActionState,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(actionState?.reducerStatus).toBe(ReactActionStateReducerStatus.Opaque);
    expect(actionState?.complete).toBe(false);
    expect(actionStateProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged Action State ownership certificate", () => {
    const report = proveFixture("refuted-action-state-outside-action");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        actionStateDispatches: report.graph.actionStateDispatches.map((dispatch) => ({
          ...dispatch,
          status: ReactActionStateDispatchStatus.Action,
          sourceComplete: true,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("Action State")),
    ).toBe(true);
  });

  it("certifies a direct Form Status consumer below its parent form", () => {
    const report = proveFixture("proved-form-status-direct");
    const formStatus = report.graph.formStatuses[0];
    const formStatusProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.FormStatus &&
          obligation.status === ReactObligationStatus.Proved,
      );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.forms).toHaveLength(1);
    expect(formStatus?.sourceFormIds).toEqual([report.graph.forms[0]?.id]);
    expect(formStatus?.outsideForm).toBe(false);
    expect(formStatus?.status).toBe(ReactFormStatusTopologyStatus.Resolved);
    expect(formStatus?.sourceComplete).toBe(true);
    expect(formStatus?.complete).toBe(true);
    expect(formStatusProof).toBeDefined();
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("propagates Form Status ancestry through a component and custom Hook", () => {
    const report = proveFixture("proved-form-status-transitive");
    const formStatus = report.graph.formStatuses[0];
    const owner = report.graph.units.find((unit) => unit.id === formStatus?.ownerId);

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(owner?.name).toBe("useCheckoutFormStatus");
    expect(formStatus?.sourceFormIds).toEqual([report.graph.forms[0]?.id]);
    expect(formStatus?.status).toBe(ReactFormStatusTopologyStatus.Resolved);
    expect(formStatus?.complete).toBe(true);
  });

  it("certifies every closed parent form for a shared Form Status consumer", () => {
    const report = proveFixture("proved-form-status-multiple-forms");
    const formStatus = report.graph.formStatuses[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.forms).toHaveLength(2);
    expect(new Set(formStatus?.sourceFormIds)).toEqual(
      new Set(report.graph.forms.map((form) => form.id)),
    );
    expect(formStatus?.outsideForm).toBe(false);
    expect(formStatus?.complete).toBe(true);
  });

  it("certifies a Form Status consumer through a component-owned children slot", () => {
    const report = proveFixture("proved-form-status-composed-form");
    const formStatus = report.graph.formStatuses[0];
    const slotFlowProof = report.units
      .flatMap((unit) => unit.obligations)
      .find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ReactNodeFlow &&
          obligation.status === ReactObligationStatus.Proved,
      );
    const slotInput = report.graph.renders.find(
      (render) => render.kind === ReactSemanticRenderKind.SlotInput,
    );
    const slotRender = report.graph.renders.find(
      (render) => render.kind === ReactSemanticRenderKind.Slot,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(formStatus?.sourceFormIds).toEqual([report.graph.forms[0]?.id]);
    expect(formStatus?.outsideForm).toBe(false);
    expect(formStatus?.status).toBe(ReactFormStatusTopologyStatus.Resolved);
    expect(formStatus?.sourceComplete).toBe(true);
    expect(formStatus?.complete).toBe(true);
    expect(report.graph.slotFlows[0]?.complete).toBe(true);
    expect(slotRender?.sourceRenderId).toBe(slotInput?.id);
    expect(slotRender?.activeFormIds).toEqual([report.graph.forms[0]?.id]);
    expect(slotFlowProof).toBeDefined();
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each([
    "proved-form-status-transitive-slot",
    "proved-form-status-named-slot",
    "proved-form-status-source-form-slot",
    "proved-form-status-computed-slot",
    "proved-form-status-portal-slot",
  ])("certifies project-local ReactNode topology in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const formStatus = report.graph.formStatuses[0];

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(report.graph.slotFlows.every((slotFlow) => slotFlow.complete)).toBe(true);
    expect(formStatus?.status).toBe(ReactFormStatusTopologyStatus.Resolved);
    expect(formStatus?.complete).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each(["proved-context-provider-slot", "proved-context-provider-transitive-slot"])(
    "carries a context provider through component-owned children slots in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const provider = report.graph.contextProviders[0];
      const consumer = report.graph.contextConsumers[0];

      expect(report.status).toBe(ReactAppProofStatus.Proved);
      expect(report.graph.slotFlows[0]?.complete).toBe(true);
      expect(consumer?.sourceProviderIds).toEqual([provider?.id]);
      expect(consumer?.usesDefaultValue).toBe(false);
      expect(consumer?.topologyComplete).toBe(true);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it.each([
    {
      fixtureName: "incomplete-react-node-external-slot",
      placementComplete: false,
      sourceComplete: true,
    },
    {
      fixtureName: "incomplete-react-node-alias-slot",
      placementComplete: false,
      sourceComplete: true,
    },
    {
      fixtureName: "incomplete-react-node-children-map",
      placementComplete: false,
      sourceComplete: true,
    },
    {
      fixtureName: "incomplete-react-node-source-alias",
      placementComplete: false,
      sourceComplete: false,
    },
    {
      fixtureName: "incomplete-react-node-spread-slot",
      placementComplete: false,
      sourceComplete: false,
    },
    {
      fixtureName: "incomplete-react-node-computed-slot",
      placementComplete: false,
      sourceComplete: true,
    },
    {
      fixtureName: "incomplete-react-node-props-spread",
      placementComplete: false,
      sourceComplete: true,
    },
    {
      fixtureName: "incomplete-react-node-non-rendered-prop",
      placementComplete: false,
      sourceComplete: false,
    },
  ])(
    "fails closed for unresolved ReactNode topology in $fixtureName",
    ({ fixtureName, placementComplete, sourceComplete }) => {
      const report = proveFixture(fixtureName);
      const incompleteSlotFlow = report.graph.slotFlows.find((slotFlow) => !slotFlow.complete);
      const reactNodeProof = report.units
        .flatMap((unit) => unit.obligations)
        .find(
          (obligation) =>
            obligation.claim === ReactProofClaim.ReactNodeFlow &&
            obligation.status === ReactObligationStatus.Unknown,
        );

      expect(report.status).toBe(ReactAppProofStatus.Incomplete);
      expect(incompleteSlotFlow?.placementComplete).toBe(placementComplete);
      expect(incompleteSlotFlow?.sourceComplete).toBe(sourceComplete);
      expect(report.graph.formStatuses[0]?.status).toBe(ReactFormStatusTopologyStatus.Unknown);
      expect(reactNodeProof?.evidence[0]?.description).toMatch(
        /project-local|unresolved source expression/,
      );
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("does not turn a ReactNode used only as a condition into an effective render", () => {
    const report = proveFixture("incomplete-react-node-dropped-slot");
    const slotFlow = report.graph.slotFlows[0];
    const reactNodeProof = report.units
      .find((unit) => unit.name === "Checkout")
      ?.obligations.find(
        (obligation) =>
          obligation.claim === ReactProofClaim.ReactNodeFlow &&
          obligation.status === ReactObligationStatus.Proved,
      );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(slotFlow?.complete).toBe(true);
    expect(slotFlow?.renderIds).toEqual([]);
    expect(report.graph.formStatuses[0]?.status).toBe(ReactFormStatusTopologyStatus.Unknown);
    expect(reactNodeProof).toBeDefined();
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged ReactNode slot-flow certificate", () => {
    const report = proveFixture("proved-form-status-composed-form");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        slotFlows: report.graph.slotFlows.map((slotFlow) => ({
          ...slotFlow,
          complete: false,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(certificate.failures.some((failure) => failure.description.includes("slot flow"))).toBe(
      true,
    );
  });

  it("fails closed when a synchronous render callback has unmodeled form ancestry", () => {
    const report = proveFixture("incomplete-form-status-render-callback");
    const formStatus = report.graph.formStatuses[0];

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(formStatus?.sourceFormIds).toEqual([]);
    expect(formStatus?.outsideForm).toBe(false);
    expect(formStatus?.status).toBe(ReactFormStatusTopologyStatus.Unknown);
    expect(formStatus?.complete).toBe(false);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged Form Status topology certificate", () => {
    const report = proveFixture("refuted-form-status-outside-form");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        formStatuses: report.graph.formStatuses.map((formStatus) => ({
          ...formStatus,
          outsideForm: false,
          status: ReactFormStatusTopologyStatus.Resolved,
          sourceComplete: true,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("Form Status")),
    ).toBe(true);
  });

  it("certifies a Form Action, pure optimistic reducer, and optimistic update together", () => {
    const report = proveFixture("proved-optimistic-form");
    const formAction = report.graph.formActions[0];
    const formCallback = report.graph.callbacks.find(
      (callback) => callback.id === formAction?.actionCallbackIds[0],
    );
    const optimisticState = report.graph.optimisticStates[0];
    const optimisticUpdate = report.graph.optimisticUpdates[0];
    const reducerCallback = report.graph.callbacks.find(
      (callback) => callback.id === optimisticState?.reducerCallbackId,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(formAction?.status).toBe(ReactFormActionStatus.Resolved);
    expect(formAction?.complete).toBe(true);
    expect(formCallback?.kind).toBe(ReactSemanticCallbackKind.FormAction);
    expect(formCallback?.phase).toBe(ReactExecutionPhase.FormAction);
    expect(optimisticState?.reducerStatus).toBe(ReactOptimisticReducerStatus.Pure);
    expect(optimisticState?.complete).toBe(true);
    expect(reducerCallback?.phase).toBe(ReactExecutionPhase.OptimisticReducer);
    expect(optimisticUpdate?.actionStatus).toBe(ReactOptimisticActionStatus.Action);
    expect(optimisticUpdate?.updaterStatus).toBe(ReactHookStateUpdaterStatus.DirectValue);
    expect(optimisticUpdate?.executionCallbackIds).toContain(formAction?.actionCallbackIds[0]);
    expect(optimisticUpdate?.complete).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("certifies nested submitters and helper-rendered spread Actions", () => {
    const submitterReport = proveFixture("proved-form-action-submitter");
    const helperReport = proveFixture("proved-helper-spread-form-action");

    expect(submitterReport.status).toBe(ReactAppProofStatus.Proved);
    expect(submitterReport.graph.formActions[0]?.status).toBe(ReactFormActionStatus.Resolved);
    expect(helperReport.status).toBe(ReactAppProofStatus.Proved);
    expect(helperReport.graph.formActions[0]?.status).toBe(ReactFormActionStatus.Resolved);
    expect(helperReport.graph.optimisticUpdates[0]?.actionStatus).toBe(
      ReactOptimisticActionStatus.Action,
    );
  });

  it("certifies a pure updater owned by a Transition Action", () => {
    const report = proveFixture("proved-optimistic-transition-updater");
    const update = report.graph.optimisticUpdates[0];
    const updaterCallback = report.graph.callbacks.find(
      (callback) => callback.id === update?.updaterCallbackId,
    );

    expect(report.status).toBe(ReactAppProofStatus.Proved);
    expect(update?.actionStatus).toBe(ReactOptimisticActionStatus.Action);
    expect(update?.updaterStatus).toBe(ReactHookStateUpdaterStatus.Pure);
    expect(updaterCallback?.phase).toBe(ReactExecutionPhase.OptimisticUpdater);
  });

  it.each([
    ["incomplete-dynamic-form-action-control", ReactFormActionStatus.Opaque],
    ["incomplete-composed-form-action-submitter", ReactFormActionStatus.Opaque],
    ["incomplete-form-action-prop", ReactFormActionStatus.Opaque],
  ])("fails closed for incomplete Form Action semantics in %s", (fixtureName, expectedStatus) => {
    const report = proveFixture(fixtureName);
    const formAction = report.graph.formActions[0];
    const formProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.FormActions,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(formAction?.status).toBe(expectedStatus);
    expect(formAction?.complete).toBe(false);
    expect(formProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("fails closed when an optimistic setter escapes its execution graph", () => {
    const report = proveFixture("incomplete-optimistic-setter-escape");
    const update = report.graph.optimisticUpdates.find(
      (candidate) => candidate.updaterStatus === ReactHookStateUpdaterStatus.SetterEscape,
    );
    const optimisticProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.OptimisticState,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(update?.actionStatus).toBe(ReactOptimisticActionStatus.Unknown);
    expect(update?.complete).toBe(false);
    expect(optimisticProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("does not treat an incomplete async Transition root as optimistic Action ownership", () => {
    const report = proveFixture("incomplete-optimistic-async-transition");
    const update = report.graph.optimisticUpdates[0];

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(update?.actionStatus).toBe(ReactOptimisticActionStatus.Unknown);
    expect(update?.sourceComplete).toBe(false);
    expect(update?.complete).toBe(false);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged optimistic Action certificate", () => {
    const report = proveFixture("refuted-optimistic-outside-action");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        optimisticUpdates: report.graph.optimisticUpdates.map((update) => ({
          ...update,
          actionStatus: ReactOptimisticActionStatus.Action,
          sourceComplete: true,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) => failure.description.includes("optimistic update")),
    ).toBe(true);
  });

  it("records concrete invalid state, constructor side-effect, setState, and missing-state issues", () => {
    const expectations: ReadonlyArray<ClassConstructionIssueExpectation> = [
      {
        fixtureName: "refuted-class-invalid-state",
        issueKind: ReactClassConstructionIssueKind.InvalidStateValue,
      },
      {
        fixtureName: "refuted-class-constructor-side-effect",
        issueKind: ReactClassConstructionIssueKind.SideEffect,
      },
      {
        fixtureName: "refuted-class-constructor-subscription",
        issueKind: ReactClassConstructionIssueKind.SideEffect,
      },
      {
        fixtureName: "refuted-class-field-side-effect",
        issueKind: ReactClassConstructionIssueKind.SideEffect,
      },
      {
        fixtureName: "refuted-class-constructor-order",
        issueKind: ReactClassConstructionIssueKind.InvalidSuperCall,
      },
      {
        fixtureName: "refuted-class-constructor-set-state",
        issueKind: ReactClassConstructionIssueKind.SetStateCall,
      },
      {
        fixtureName: "refuted-class-missing-state",
        issueKind: ReactClassConstructionIssueKind.MissingStateInitialization,
      },
      {
        fixtureName: "refuted-class-missing-updater-state",
        issueKind: ReactClassConstructionIssueKind.MissingStateInitialization,
      },
    ];

    for (const expectation of expectations) {
      const report = proveFixture(expectation.fixtureName);
      const construction = report.graph.classConstructions[0];

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(construction?.issues.some((issue) => issue.kind === expectation.issueKind)).toBe(true);
      expect(construction?.status).toBe(ReactClassConstructionStatus.Invalid);
      expect(construction?.sourceComplete).toBe(true);
      expect(construction?.complete).toBe(false);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    }
  });

  it.each([
    [
      "incomplete-class-opaque-state-initializer",
      ReactClassConstructionIssueKind.UnsupportedInitializer,
    ],
    [
      "incomplete-class-multiple-state-initializers",
      ReactClassConstructionIssueKind.MultipleStateInitializations,
    ],
    [
      "incomplete-class-conditional-state-initializer",
      ReactClassConstructionIssueKind.UnsupportedConstructorStatement,
    ],
    [
      "incomplete-class-custom-subscription-lookalike",
      ReactClassConstructionIssueKind.UnsupportedInitializer,
    ],
  ])("fails closed for unresolved class construction in %s", (fixtureName, issueKind) => {
    const report = proveFixture(fixtureName);
    const construction = report.graph.classConstructions[0];
    const constructionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassConstruction,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(construction?.issues.some((issue) => issue.kind === issueKind)).toBe(true);
    expect(construction?.status).toBe(ReactClassConstructionStatus.Unknown);
    expect(construction?.sourceComplete).toBe(false);
    expect(construction?.complete).toBe(false);
    expect(constructionProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("leaves unsupported class field syntax incomplete after proving its initializer", () => {
    const report = proveFixture("incomplete-class-accessor-field");
    const construction = report.graph.classConstructions[0];
    const constructionProof = report.units[0]?.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassConstruction,
    );

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(construction?.issues.map((issue) => issue.kind)).toEqual([
      ReactClassConstructionIssueKind.UnsupportedInitializer,
    ]);
    expect(construction?.status).toBe(ReactClassConstructionStatus.Unknown);
    expect(constructionProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged class construction status", () => {
    const report = proveFixture("proved-class-state-field");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        classConstructions: report.graph.classConstructions.map((construction) => ({
          ...construction,
          status: ReactClassConstructionStatus.Invalid,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("status does not match its issues"),
      ),
    ).toBe(true);
  });

  it("does not mistake a shadowed Component base for React inheritance", () => {
    const report = proveFixture("shadowed-component-class");

    expect(report.graph.units).toEqual([]);
  });

  it.each([
    "proved-error-boundary",
    "proved-error-boundary-slot",
    "proved-error-boundary-helper-throw",
  ])("proves a valid Error Boundary around a reachable render failure in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const definition = report.graph.errorBoundaryDefinitions[0];
    const renderFailure = report.graph.renderFailures[0];
    const failureProof = report.units
      .find((unit) => unit.name === "BrokenPanel")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.ErrorBoundary);

    expect(definition?.derivedStateStatus).toBe(ReactErrorBoundaryProtocolStatus.Valid);
    expect(definition?.fallbackRenderStatus).toBe(ReactErrorBoundaryProtocolStatus.Valid);
    expect(definition?.complete).toBe(true);
    expect(report.graph.errorBoundaries).toHaveLength(1);
    expect(renderFailure?.sourceBoundaryIds).toHaveLength(1);
    expect(renderFailure?.coverageStatus).toBe(ReactErrorBoundaryCoverageStatus.Covered);
    expect(renderFailure?.complete).toBe(true);
    expect(failureProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes a reachable render failure outside an Error Boundary", () => {
    const report = proveFixture("refuted-render-error-outside-boundary");
    const renderFailure = report.graph.renderFailures[0];
    const failureProof = report.units
      .find((unit) => unit.name === "BrokenPanel")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.ErrorBoundary);

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(renderFailure?.outsideBoundary).toBe(true);
    expect(renderFailure?.coverageStatus).toBe(ReactErrorBoundaryCoverageStatus.OutsideBoundary);
    expect(failureProof?.status).toBe(ReactObligationStatus.Violated);
    expect(failureProof?.evidence[0]?.description).toMatch(/escape/);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes an Error Boundary that cannot transition into fallback state", () => {
    const report = proveFixture("refuted-invalid-error-boundary");
    const definition = report.graph.errorBoundaryDefinitions[0];
    const boundaryProof = report.units
      .find((unit) => unit.name === "ErrorBoundary")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.ErrorBoundary);

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(definition?.derivedStateStatus).toBe(ReactErrorBoundaryProtocolStatus.Invalid);
    expect(definition?.complete).toBe(false);
    expect(boundaryProof?.status).toBe(ReactObligationStatus.Violated);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("fails closed when Error Boundary state recovery crosses a helper", () => {
    const report = proveFixture("incomplete-opaque-error-boundary");
    const definition = report.graph.errorBoundaryDefinitions[0];
    const renderFailure = report.graph.renderFailures[0];

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(definition?.derivedStateStatus).toBe(ReactErrorBoundaryProtocolStatus.Unknown);
    expect(renderFailure?.coverageStatus).toBe(ReactErrorBoundaryCoverageStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("does not treat an event-handler exception as a render failure", () => {
    const report = proveFixture("proved-event-error-outside-boundary-scope");
    const appProof = report.units
      .find((unit) => unit.name === "App")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.ErrorBoundary);

    expect(report.graph.renderFailures).toEqual([]);
    expect(appProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged Error Boundary coverage certificate", () => {
    const report = proveFixture("refuted-render-error-outside-boundary");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        renderFailures: report.graph.renderFailures.map((renderFailure) => ({
          ...renderFailure,
          outsideBoundary: false,
          coverageStatus: ReactErrorBoundaryCoverageStatus.Covered,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("render failure coverage status"),
      ),
    ).toBe(true);
  });

  it.each(["proved-use-resource", "proved-use-resource-hook", "proved-use-resource-state"])(
    "proves a stable use resource with pending and rejection containment in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const resource = report.graph.useResources[0];
      const resourceProof = report.units
        .find(
          (unit) => unit.name === (fixtureName.endsWith("-hook") ? "useMessage" : "ResourcePanel"),
        )
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.UseResource);

      expect(resource?.kind).toBe(ReactUseResourceKind.Thenable);
      expect(resource?.identityStatus).toBe(ReactUseResourceIdentityStatus.Stable);
      expect(resource?.suspenseCoverageStatus).toBe(ReactSuspenseCoverageStatus.Covered);
      expect(resource?.errorCoverageStatus).toBe(ReactErrorBoundaryCoverageStatus.Covered);
      expect(resource?.sourceSuspenseBoundaryIds).toHaveLength(1);
      expect(resource?.sourceErrorBoundaryIds).toHaveLength(1);
      expect(resource?.complete).toBe(true);
      expect(resourceProof?.status).toBe(ReactObligationStatus.Proved);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it.each(["refuted-use-resource-fresh-promise", "refuted-use-resource-state-fresh"])(
    "refutes a Promise created during React execution even when boundaries are present in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const resource = report.graph.useResources[0];
      const resourceProof = report.units
        .find((unit) => unit.name === "ResourcePanel")
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.UseResource);

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(resource?.identityStatus).toBe(ReactUseResourceIdentityStatus.Unstable);
      expect(resourceProof?.status).toBe(ReactObligationStatus.Violated);
      expect(
        resourceProof?.evidence.some((evidence) => evidence.description.includes("created")),
      ).toBe(true);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it.each([
    [
      "refuted-use-resource-outside-suspense",
      ReactSuspenseCoverageStatus.OutsideBoundary,
      ReactErrorBoundaryCoverageStatus.Covered,
    ],
    [
      "refuted-use-resource-outside-error-boundary",
      ReactSuspenseCoverageStatus.Covered,
      ReactErrorBoundaryCoverageStatus.OutsideBoundary,
    ],
  ])(
    "refutes missing pending or rejection containment in %s",
    (fixtureName, suspenseStatus, errorStatus) => {
      const report = proveFixture(fixtureName);
      const resource = report.graph.useResources[0];

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(resource?.suspenseCoverageStatus).toBe(suspenseStatus);
      expect(resource?.errorCoverageStatus).toBe(errorStatus);
      expect(resource?.complete).toBe(false);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("refutes mixed valid and invalid Error Boundary resource paths", () => {
    const report = proveFixture("refuted-use-resource-mixed-error-boundaries");
    const resource = report.graph.useResources[0];
    const resourceProof = report.units
      .find((unit) => unit.name === "ResourcePanel")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.UseResource);

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(resource?.sourceErrorBoundaryIds).toHaveLength(2);
    expect(resource?.errorTopologyComplete).toBe(true);
    expect(resource?.errorCoverageStatus).toBe(ReactErrorBoundaryCoverageStatus.OutsideBoundary);
    expect(resourceProof?.status).toBe(ReactObligationStatus.Violated);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("fails closed when a Promise resource has opaque cache identity", () => {
    const report = proveFixture("incomplete-use-resource-prop");
    const resource = report.graph.useResources[0];

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(resource?.kind).toBe(ReactUseResourceKind.Thenable);
    expect(resource?.identityStatus).toBe(ReactUseResourceIdentityStatus.Unknown);
    expect(resource?.complete).toBe(false);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("refutes a non-thenable passed to use", () => {
    const report = proveFixture("refuted-use-resource-invalid");
    const resource = report.graph.useResources[0];

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(resource?.kind).toBe(ReactUseResourceKind.Invalid);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged use resource containment certificate", () => {
    const report = proveFixture("refuted-use-resource-outside-suspense");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        useResources: report.graph.useResources.map((resource) => ({
          ...resource,
          outsideSuspenseBoundary: false,
          suspenseCoverageStatus: ReactSuspenseCoverageStatus.Covered,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("use resource Suspense certificate"),
      ),
    ).toBe(true);
  });

  it.each([
    "proved-host-control",
    "proved-host-control-uncontrolled",
    "proved-host-control-immutable",
    "proved-host-control-normalized",
  ])("proves complete intrinsic form ownership in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const controlProof = report.units
      .find((unit) => unit.name === "App")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.HostControl);

    expect(report.graph.hostControls.length).toBeGreaterThan(0);
    expect(report.graph.hostControls.every((control) => control.complete)).toBe(true);
    expect(controlProof?.status).toBe(ReactObligationStatus.Proved);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("links text, textarea, checkbox, and select controls to exact event transitions", () => {
    const report = proveFixture("proved-host-control");
    const kinds = new Set(report.graph.hostControls.map((control) => control.kind));

    expect(kinds).toEqual(
      new Set([
        ReactHostControlKind.CheckableInput,
        ReactHostControlKind.Select,
        ReactHostControlKind.TextInput,
        ReactHostControlKind.Textarea,
      ]),
    );
    expect(
      report.graph.hostControls.every(
        (control) =>
          control.updateStatus === ReactHostControlUpdateStatus.Exact &&
          control.callbackIds.length === 1 &&
          control.transitionIds.length === 1,
      ),
    ).toBe(true);
  });

  it.each([
    {
      fixtureName: "refuted-host-control-switch",
      updateStatus: ReactHostControlUpdateStatus.Exact,
      valueStatus: ReactHostControlValueStatus.MaySwitch,
    },
    {
      fixtureName: "refuted-host-control-conflict",
      updateStatus: ReactHostControlUpdateStatus.Exact,
      valueStatus: ReactHostControlValueStatus.Defined,
    },
    {
      fixtureName: "refuted-host-control-missing-update",
      updateStatus: ReactHostControlUpdateStatus.Missing,
      valueStatus: ReactHostControlValueStatus.Defined,
    },
    {
      fixtureName: "refuted-host-control-deferred-update",
      updateStatus: ReactHostControlUpdateStatus.Deferred,
      valueStatus: ReactHostControlValueStatus.Defined,
    },
    {
      fixtureName: "refuted-host-control-wrong-value",
      updateStatus: ReactHostControlUpdateStatus.WrongValue,
      valueStatus: ReactHostControlValueStatus.Defined,
    },
  ])(
    "refutes the host control protocol in $fixtureName",
    ({ fixtureName, updateStatus, valueStatus }) => {
      const report = proveFixture(fixtureName);
      const control = report.graph.hostControls[0];
      const controlProof = report.units
        .find((unit) => unit.name === "App")
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.HostControl);

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(control?.status).toBe(ReactHostControlStatus.Invalid);
      expect(control?.valueStatus).toBe(valueStatus);
      expect(control?.updateStatus).toBe(updateStatus);
      expect(controlProof?.status).toBe(ReactObligationStatus.Violated);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it.each(["incomplete-host-control-prop", "incomplete-host-control-spread"])(
    "fails closed for an open host control contract in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const control = report.graph.hostControls[0];
      const controlProof = report.units
        .find((unit) => unit.name === "App")
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.HostControl);

      expect(report.status).toBe(ReactAppProofStatus.Incomplete);
      expect(control?.status).toBe(ReactHostControlStatus.Unknown);
      expect(control?.complete).toBe(false);
      expect(controlProof?.status).toBe(ReactObligationStatus.Unknown);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("fails closed for unsupported host control protocols", () => {
    const report = proveFixture("incomplete-host-control-unsupported");

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.hostControls.map((control) => control.kind)).toEqual([
      ReactHostControlKind.FileInput,
      ReactHostControlKind.SelectMultiple,
      ReactHostControlKind.Unknown,
    ]);
    expect(
      report.graph.hostControls.every(
        (control) =>
          control.status === ReactHostControlStatus.Unknown && control.complete === false,
      ),
    ).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged host control certificate", () => {
    const report = proveFixture("refuted-host-control-switch");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        hostControls: report.graph.hostControls.map((control) => ({
          ...control,
          valueStatus: ReactHostControlValueStatus.Defined,
          status: ReactHostControlStatus.Resolved,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("Host control facts require"),
      ),
    ).toBe(true);
  });

  it.each([
    "proved-lazy-suspense",
    "proved-lazy-suspense-wrapper",
    "proved-lazy-suspense-slot",
    "proved-lazy-namespace-memo",
    "proved-lazy-render-helper",
    "proved-lazy-map-render",
    "proved-class-lazy-suspense",
    "proved-nested-suspense-fallback",
    "proved-async-lazy-loader",
    "proved-lazy-object-alias",
  ])("proves stable lazy loading and every Suspense path in %s", (fixtureName) => {
    const report = proveFixture(fixtureName);
    const lazyProofs = report.units
      .flatMap((unit) => unit.obligations)
      .filter((obligation) => obligation.claim === ReactProofClaim.LazySuspense);

    expect(report.graph.lazyComponents).toHaveLength(1);
    expect(report.graph.lazyComponents[0]?.declarationStatus).toBe(
      ReactLazyDeclarationStatus.ModuleStable,
    );
    expect(report.graph.lazyComponents[0]?.loaderStatus).toBe(ReactLazyLoaderStatus.Valid);
    expect(report.graph.lazyComponents[0]?.complete).toBe(true);
    expect(report.graph.lazyRenders).toHaveLength(1);
    expect(report.graph.lazyRenders[0]?.coverageStatus).toBe(ReactSuspenseCoverageStatus.Covered);
    expect(report.graph.lazyRenders[0]?.sourceBoundaryIds).toHaveLength(1);
    expect(
      lazyProofs.every((obligation) => obligation.status === ReactObligationStatus.Proved),
    ).toBe(true);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each(["refuted-lazy-outside-suspense", "refuted-lazy-suspense-fallback"])(
    "refutes a root-reachable lazy render outside a catching boundary in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const render = report.graph.lazyRenders[0];
      const owningUnitName = fixtureName === "refuted-lazy-outside-suspense" ? "PanelRoute" : "App";
      const routeProof = report.units
        .find((unit) => unit.name === owningUnitName)
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.LazySuspense);

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(render?.outsideBoundary).toBe(true);
      expect(render?.coverageStatus).toBe(ReactSuspenseCoverageStatus.OutsideBoundary);
      expect(routeProof?.status).toBe(ReactObligationStatus.Violated);
      expect(routeProof?.evidence[0]?.description).toMatch(/outside Suspense/);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it("refutes lazy component identity recreated during render", () => {
    const report = proveFixture("refuted-render-lazy-declaration");
    const component = report.graph.lazyComponents[0];
    const lazyProof = report.units
      .find((unit) => unit.name === "App")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.LazySuspense);

    expect(report.status).toBe(ReactAppProofStatus.Refuted);
    expect(component?.declarationStatus).toBe(ReactLazyDeclarationStatus.RenderUnstable);
    expect(component?.complete).toBe(false);
    expect(lazyProof?.status).toBe(ReactObligationStatus.Violated);
    expect(lazyProof?.evidence[0]?.description).toMatch(/redeclared/);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it.each([
    "incomplete-exported-lazy-root",
    "incomplete-exported-lazy-alias",
    "incomplete-exported-lazy-opaque-alias",
  ])(
    "keeps an exported lazy component root open while proving its internal render in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const component = report.graph.lazyComponents[0];
      const appProof = report.units
        .find((unit) => unit.name === "App")
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.LazySuspense);

      expect(report.status).toBe(ReactAppProofStatus.Incomplete);
      expect(component?.canBeRenderRoot).toBe(true);
      expect(component?.complete).toBe(false);
      expect(appProof?.status).toBe(ReactObligationStatus.Proved);
      expect(report.projectEvidence[0]?.description).toMatch(/open Suspense topology/);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it.each(["refuted-invalid-lazy-loader", "refuted-union-lazy-loader"])(
    "refutes a lazy loader that cannot always resolve a default component in %s",
    (fixtureName) => {
      const report = proveFixture(fixtureName);
      const component = report.graph.lazyComponents[0];
      const lazyProof = report.units
        .find((unit) => unit.name === "App")
        ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.LazySuspense);

      expect(report.status).toBe(ReactAppProofStatus.Refuted);
      expect(component?.loaderStatus).toBe(ReactLazyLoaderStatus.Invalid);
      expect(component?.sourceComplete).toBe(true);
      expect(lazyProof?.status).toBe(ReactObligationStatus.Violated);
      expect(lazyProof?.evidence[0]?.description).toMatch(/callable default export/);
      expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
    },
  );

  it.each([
    ["incomplete-opaque-lazy-loader", 1],
    ["incomplete-lazy-external-slot", 1],
    ["incomplete-lazy-opaque-wrapper", 0],
    ["incomplete-lazy-opaque-alias", 1],
  ])("fails closed for unresolved lazy semantics in %s", (fixtureName, expectedRenderCount) => {
    const report = proveFixture(fixtureName);
    const lazyProof = report.units
      .find((unit) => unit.name === "App")
      ?.obligations.find((obligation) => obligation.claim === ReactProofClaim.LazySuspense);

    expect(report.status).toBe(ReactAppProofStatus.Incomplete);
    expect(report.graph.lazyRenders).toHaveLength(expectedRenderCount);
    expect(lazyProof?.status).toBe(ReactObligationStatus.Unknown);
    expect(checkReactProofReport(report).status).toBe(ReactProofCertificateStatus.Valid);
  });

  it("rejects a forged lazy Suspense coverage certificate", () => {
    const report = proveFixture("refuted-lazy-outside-suspense");
    const certificate = checkReactProofReport({
      ...report,
      graph: {
        ...report.graph,
        lazyRenders: report.graph.lazyRenders.map((render) => ({
          ...render,
          outsideBoundary: false,
          sourceComplete: true,
          coverageStatus: ReactSuspenseCoverageStatus.Covered,
          complete: true,
        })),
      },
    });

    expect(certificate.status).toBe(ReactProofCertificateStatus.Invalid);
    expect(
      certificate.failures.some((failure) =>
        failure.description.includes("lazy render coverage status"),
      ),
    ).toBe(true);
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
