import type ts from "typescript";

export enum ReactAppProofStatus {
  Proved = "proved",
  Refuted = "refuted",
  Incomplete = "incomplete",
}

export enum ReactObligationStatus {
  Proved = "proved",
  Violated = "violated",
  Unknown = "unknown",
}

export enum ReactProofClaim {
  BoundaryCoverage = "boundary-coverage",
  CallableRefFreshness = "callable-ref-freshness",
  ComponentIdentity = "component-identity",
  ComponentInvocation = "component-invocation",
  ContextTopology = "context-topology",
  AsyncEffectOwnership = "async-effect-ownership",
  EffectCleanup = "effect-cleanup",
  EffectDependencies = "effect-dependencies",
  EffectEventUsage = "effect-event-usage",
  EffectStateUpdates = "effect-state-updates",
  ExternalStoreConsistency = "external-store-consistency",
  HookOrder = "hook-order",
  HookOwnership = "hook-ownership",
  MemoDependencies = "memo-dependencies",
  ReconciliationIdentity = "reconciliation-identity",
  ReducerPurity = "reducer-purity",
  RefAccess = "ref-access",
  RenderPurity = "render-purity",
  ScheduledCallbackLifetime = "scheduled-callback-lifetime",
}

export enum ReactUnitKind {
  ClassComponent = "class-component",
  Component = "component",
  Hook = "hook",
  InvalidHookOwner = "invalid-hook-owner",
}

export enum ReactSemanticEdgeKind {
  CallsHook = "calls-hook",
  RendersComponent = "renders-component",
}

export enum ReactEffectDependencyMode {
  Inline = "inline",
  Missing = "missing",
  Opaque = "opaque",
}

export enum ReactCompilerFactStatus {
  Complete = "complete",
  Incomplete = "incomplete",
}

export enum ReactExecutionPhase {
  ClassMount = "class-mount",
  ClassUnmount = "class-unmount",
  Deferred = "deferred",
  EffectCleanup = "effect-cleanup",
  EffectEvent = "effect-event",
  EffectSetup = "effect-setup",
  Event = "event",
  ExternalStoreSubscription = "external-store-subscription",
  Render = "render",
  ServerRender = "server-render",
  StateTransition = "state-transition",
}

export enum ReactSemanticCallbackKind {
  ClassMount = "class-mount",
  ClassUnmount = "class-unmount",
  ComponentRender = "component-render",
  EffectCleanup = "effect-cleanup",
  EffectEvent = "effect-event",
  EffectSetup = "effect-setup",
  EventHandler = "event-handler",
  ExternalStoreSnapshot = "external-store-snapshot",
  ExternalStoreSubscribe = "external-store-subscribe",
  MemoFactory = "memo-factory",
  MemoizedCallback = "memoized-callback",
  Reducer = "reducer",
  ReducerInitializer = "reducer-initializer",
  ResourceCallback = "resource-callback",
  ScheduledCallback = "scheduled-callback",
  ServerSnapshot = "server-snapshot",
}

export enum ReactSemanticFunctionCallKind {
  Captured = "captured",
  Direct = "direct",
  Parameter = "parameter",
  Property = "property",
  SynchronousCallback = "synchronous-callback",
}

export interface ReactProofLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface ReactProofEvidence {
  description: string;
  location: ReactProofLocation;
  trace: ReadonlyArray<string>;
}

export interface ReactProofObligation {
  claim: ReactProofClaim;
  status: ReactObligationStatus;
  summary: string;
  evidence: ReadonlyArray<ReactProofEvidence>;
}

export interface ReactUnitProof {
  name: string;
  kind: ReactUnitKind;
  location: ReactProofLocation;
  obligations: ReadonlyArray<ReactProofObligation>;
}

export interface ReactSemanticUnit {
  id: string;
  name: string;
  kind: ReactUnitKind;
  location: ReactProofLocation;
  sourceComplete: boolean;
}

export interface ReactSemanticEdge {
  kind: ReactSemanticEdgeKind;
  sourceId: string;
  targetId: string;
  location: ReactProofLocation;
}

export interface ReactSemanticHookCall {
  id: string;
  ownerId: string;
  name: string;
  targetId: string;
  location: ReactProofLocation;
}

export interface ReactSemanticEffect {
  id: string;
  ownerId: string;
  hookName: string;
  location: ReactProofLocation;
  callbackResolved: boolean;
  dependencyMode: ReactEffectDependencyMode;
  dependencies: ReadonlyArray<string>;
  captures: ReadonlyArray<string>;
  hasCleanup: boolean;
  setupCallbackId: string | null;
  cleanupCallbackIds: ReadonlyArray<string>;
}

export enum ReactIdentityStability {
  Stable = "stable",
  Unstable = "unstable",
  Unknown = "unknown",
}

export enum ReactCallableRefFreshness {
  EventSynchronized = "event-synchronized",
  PassiveLag = "passive-lag",
  Unknown = "unknown",
}

export enum ReactSchedulerKind {
  AnimationFrame = "animation-frame",
  IdleCallback = "idle-callback",
  Immediate = "immediate",
  Interval = "interval",
  Microtask = "microtask",
  Timeout = "timeout",
}

export enum ReactSchedulerCancellationStatus {
  Guaranteed = "guaranteed",
  Missing = "missing",
  Unknown = "unknown",
}

export enum ReactEffectResourceKind {
  EventListener = "event-listener",
  IntersectionObserver = "intersection-observer",
  MutationObserver = "mutation-observer",
  Observer = "observer",
  ResizeObserver = "resize-observer",
}

export enum ReactEffectResourceDisposalStatus {
  Guaranteed = "guaranteed",
  Missing = "missing",
  Unknown = "unknown",
}

export enum ReactAsyncOwnershipStatus {
  Guarded = "guarded",
  Unguarded = "unguarded",
  Unknown = "unknown",
}

export enum ReactProofCertificateStatus {
  Invalid = "invalid",
  Valid = "valid",
}

export interface ReactProofCertificateFailure {
  description: string;
  subjectId: string;
}

export interface ReactProofCertificateCheck {
  status: ReactProofCertificateStatus;
  failures: ReadonlyArray<ReactProofCertificateFailure>;
}

export interface ReactAsyncEffectTaskDescriptor {
  effectCall: ts.CallExpression;
  evidenceDescription: string;
  evidenceNode: ts.Node;
  stateWriteNames: ReadonlyArray<string>;
  status: ReactAsyncOwnershipStatus;
  taskNode: ts.Node;
}

export interface ReactSemanticAsyncTask {
  id: string;
  ownerId: string;
  effectId: string;
  location: ReactProofLocation;
  stateWrites: ReadonlyArray<string>;
  ownershipStatus: ReactAsyncOwnershipStatus;
}

export interface ReactSemanticEffectEvent {
  id: string;
  ownerId: string;
  name: string;
  location: ReactProofLocation;
  callbackId: string | null;
  identityStability: ReactIdentityStability;
}

export interface ReactSemanticExternalStore {
  id: string;
  ownerId: string;
  location: ReactProofLocation;
  subscribeCallbackIds: ReadonlyArray<string>;
  subscribeComplete: boolean;
  snapshotCallbackIds: ReadonlyArray<string>;
  snapshotComplete: boolean;
  serverSnapshotCallbackIds: ReadonlyArray<string>;
  serverSnapshotComplete: boolean;
  serverSnapshotProvided: boolean;
}

export interface ReactSemanticContext {
  id: string;
  name: string;
  location: ReactProofLocation;
  defaultValueText: string;
}

export interface ReactSemanticContextProvider {
  id: string;
  ownerId: string;
  contextId: string;
  location: ReactProofLocation;
  valueProvided: boolean;
  valueText: string | null;
}

export interface ReactSemanticContextConsumer {
  id: string;
  ownerId: string;
  contextId: string | null;
  hookName: string;
  location: ReactProofLocation;
  sourceProviderIds: ReadonlyArray<string>;
  usesDefaultValue: boolean;
  topologyComplete: boolean;
}

export interface ReactSemanticRender {
  id: string;
  ownerId: string;
  targetId: string;
  location: ReactProofLocation;
  activeContextProviderIds: ReadonlyArray<string>;
}

export interface ReactSemanticCallback {
  id: string;
  ownerId: string;
  kind: ReactSemanticCallbackKind;
  phase: ReactExecutionPhase;
  name: string;
  location: ReactProofLocation;
  captures: ReadonlyArray<string>;
  stateWrites: ReadonlyArray<string>;
}

export interface ReactSemanticReachableFunction {
  id: string;
  ownerId: string;
  rootCallbackId: string;
  name: string;
  phase: ReactExecutionPhase;
  location: ReactProofLocation;
  isConditionallyReached: boolean;
}

export interface ReactSemanticFunctionCall {
  id: string;
  ownerId: string;
  rootCallbackId: string;
  sourceFunctionId: string;
  targetFunctionId: string;
  kind: ReactSemanticFunctionCallKind;
  phase: ReactExecutionPhase;
  location: ReactProofLocation;
  sourceParameterIndex: number | null;
  callArgumentIndex: number | null;
  sourcePropertyPath: ReadonlyArray<string>;
  isConditionallyReached: boolean;
}

export interface ReactSemanticEventBinding {
  id: string;
  ownerId: string;
  eventName: string;
  location: ReactProofLocation;
  callbackIds: ReadonlyArray<string>;
  complete: boolean;
}

export interface ReactSemanticCallbackGuard {
  id: string;
  polarity: boolean;
}

export interface ReactSemanticCallbackPropAlternative {
  callbackId: string;
  guards: ReadonlyArray<ReactSemanticCallbackGuard>;
}

export interface ReactSemanticCallbackPropFlow {
  id: string;
  renderId: string;
  renderOwnerId: string;
  targetOwnerId: string;
  propName: string;
  phase: ReactExecutionPhase;
  location: ReactProofLocation;
  alternatives: ReadonlyArray<ReactSemanticCallbackPropAlternative>;
  callbackIds: ReadonlyArray<string>;
  complete: boolean;
}

export interface ReactSemanticCallableRef {
  id: string;
  ownerId: string;
  name: string;
  location: ReactProofLocation;
  updateHookName: string | null;
  updateLocation: ReactProofLocation | null;
  invocationCallIds: ReadonlyArray<string>;
  invocationCallbackIds: ReadonlyArray<string>;
  invocationLocations: ReadonlyArray<ReactProofLocation>;
  freshness: ReactCallableRefFreshness;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactSemanticScheduler {
  id: string;
  ownerId: string;
  effectId: string | null;
  registrationCallbackId: string;
  kind: ReactSchedulerKind;
  phase: ReactExecutionPhase;
  location: ReactProofLocation;
  callbackIds: ReadonlyArray<string>;
  callbackComplete: boolean;
  cancellationStatus: ReactSchedulerCancellationStatus;
  cancellationLocations: ReadonlyArray<ReactProofLocation>;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactSemanticEffectResource {
  id: string;
  ownerId: string;
  effectId: string | null;
  acquisitionCallbackId: string;
  kind: ReactEffectResourceKind;
  phase: ReactExecutionPhase;
  location: ReactProofLocation;
  activationLocations: ReadonlyArray<ReactProofLocation>;
  callbackIds: ReadonlyArray<string>;
  callbackComplete: boolean;
  disposalStatus: ReactEffectResourceDisposalStatus;
  disposalLocations: ReadonlyArray<ReactProofLocation>;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactSemanticClassLifecycle {
  id: string;
  ownerId: string;
  location: ReactProofLocation;
  mountCallbackId: string | null;
  unmountCallbackId: string | null;
  resourceIds: ReadonlyArray<string>;
  schedulerIds: ReadonlyArray<string>;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactCompilerInstructionFact {
  id: string;
  valueKind: string;
  lvalueId: string;
  effect: string;
  reactive: boolean;
  location: ReactProofLocation | null;
}

export interface ReactCompilerBlockFact {
  id: string;
  kind: string;
  predecessors: ReadonlyArray<string>;
  successors: ReadonlyArray<string>;
  instructions: ReadonlyArray<ReactCompilerInstructionFact>;
  terminalKind: string;
}

export interface ReactCompilerFunctionFact {
  id: string;
  functionType: string;
  location: ReactProofLocation | null;
  entryBlockId: string;
  blocks: ReadonlyArray<ReactCompilerBlockFact>;
}

export interface ReactCompilerFailure {
  description: string;
  location: ReactProofLocation;
}

export interface ReactCompilerGraph {
  version: string;
  phase: string;
  status: ReactCompilerFactStatus;
  functions: ReadonlyArray<ReactCompilerFunctionFact>;
  failures: ReadonlyArray<ReactCompilerFailure>;
}

export interface ReactSemanticGraph {
  schemaVersion: number;
  units: ReadonlyArray<ReactSemanticUnit>;
  edges: ReadonlyArray<ReactSemanticEdge>;
  hookCalls: ReadonlyArray<ReactSemanticHookCall>;
  effects: ReadonlyArray<ReactSemanticEffect>;
  effectEvents: ReadonlyArray<ReactSemanticEffectEvent>;
  externalStores: ReadonlyArray<ReactSemanticExternalStore>;
  asyncTasks: ReadonlyArray<ReactSemanticAsyncTask>;
  contexts: ReadonlyArray<ReactSemanticContext>;
  contextProviders: ReadonlyArray<ReactSemanticContextProvider>;
  contextConsumers: ReadonlyArray<ReactSemanticContextConsumer>;
  renders: ReadonlyArray<ReactSemanticRender>;
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
  eventBindings: ReadonlyArray<ReactSemanticEventBinding>;
  callbackPropFlows: ReadonlyArray<ReactSemanticCallbackPropFlow>;
  callableRefs: ReadonlyArray<ReactSemanticCallableRef>;
  schedulers: ReadonlyArray<ReactSemanticScheduler>;
  resources: ReadonlyArray<ReactSemanticEffectResource>;
  classLifecycles: ReadonlyArray<ReactSemanticClassLifecycle>;
  compiler: ReactCompilerGraph;
}

export interface ReactProofSummary {
  files: number;
  units: number;
  proved: number;
  violated: number;
  unknown: number;
}

export interface ReactAppProofReport {
  schemaVersion: number;
  status: ReactAppProofStatus;
  rootDirectory: string;
  graph: ReactSemanticGraph;
  units: ReadonlyArray<ReactUnitProof>;
  projectEvidence: ReadonlyArray<ReactProofEvidence>;
  summary: ReactProofSummary;
}

export interface ProveReactAppInput {
  rootDirectory: string;
  tsconfigPath?: string;
}

export interface ReactUnitDescriptor {
  name: string;
  kind: ReactUnitKind;
  node: ts.Node;
  classNode?: ts.ClassDeclaration;
  functionNode?: ts.FunctionLikeDeclaration;
  invalidHookCalls?: ReadonlyArray<ts.CallExpression>;
  sourceComplete: boolean;
}

export interface ReactAnalysisContext {
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  rootDirectory: string;
  graph?: ReactSemanticGraph;
}
