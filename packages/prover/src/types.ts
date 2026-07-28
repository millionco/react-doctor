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
  ActionState = "action-state",
  BoundaryCoverage = "boundary-coverage",
  CallableRefFreshness = "callable-ref-freshness",
  ClassConstruction = "class-construction",
  ClassStateTransitions = "class-state-transitions",
  ComponentIdentity = "component-identity",
  ComponentInvocation = "component-invocation",
  ContextTopology = "context-topology",
  AsyncEffectOwnership = "async-effect-ownership",
  EffectCleanup = "effect-cleanup",
  EffectDependencies = "effect-dependencies",
  EffectEventUsage = "effect-event-usage",
  EffectStateUpdates = "effect-state-updates",
  ExternalStoreConsistency = "external-store-consistency",
  FormActions = "form-actions",
  FormStatus = "form-status",
  HookOrder = "hook-order",
  HookOwnership = "hook-ownership",
  HookStateTransitions = "hook-state-transitions",
  MemoDependencies = "memo-dependencies",
  OptimisticState = "optimistic-state",
  ReconciliationIdentity = "reconciliation-identity",
  ReducerPurity = "reducer-purity",
  RefAccess = "ref-access",
  RenderPurity = "render-purity",
  ScheduledCallbackLifetime = "scheduled-callback-lifetime",
  TransitionActions = "transition-actions",
}

export enum ReactUnitKind {
  ClassComponent = "class-component",
  Component = "component",
  Hook = "hook",
  InvalidHookOwner = "invalid-hook-owner",
}

export enum ReactClassComponentBase {
  Component = "Component",
  PureComponent = "PureComponent",
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
  ActionStateReducer = "action-state-reducer",
  ClassConstruction = "class-construction",
  ClassMount = "class-mount",
  ClassUnmount = "class-unmount",
  ClassUpdate = "class-update",
  Deferred = "deferred",
  EffectCleanup = "effect-cleanup",
  EffectEvent = "effect-event",
  EffectSetup = "effect-setup",
  Event = "event",
  ExternalStoreSubscription = "external-store-subscription",
  FormAction = "form-action",
  OptimisticReducer = "optimistic-reducer",
  OptimisticUpdater = "optimistic-updater",
  Render = "render",
  ServerRender = "server-render",
  StateTransition = "state-transition",
  TransitionAction = "transition-action",
}

export enum ReactSemanticCallbackKind {
  ActionStateReducer = "action-state-reducer",
  ClassMount = "class-mount",
  ClassStateUpdater = "class-state-updater",
  ClassUnmount = "class-unmount",
  ClassUpdate = "class-update",
  ComponentRender = "component-render",
  EffectCleanup = "effect-cleanup",
  EffectEvent = "effect-event",
  EffectSetup = "effect-setup",
  EventHandler = "event-handler",
  ExternalStoreSnapshot = "external-store-snapshot",
  ExternalStoreSubscribe = "external-store-subscribe",
  FormAction = "form-action",
  HookStateUpdater = "hook-state-updater",
  MemoFactory = "memo-factory",
  MemoizedCallback = "memoized-callback",
  OptimisticReducer = "optimistic-reducer",
  OptimisticUpdater = "optimistic-updater",
  Reducer = "reducer",
  ReducerInitializer = "reducer-initializer",
  ResourceCallback = "resource-callback",
  ScheduledCallback = "scheduled-callback",
  ServerSnapshot = "server-snapshot",
  TransitionAction = "transition-action",
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
  classComponentBase: ReactClassComponentBase | null;
  canBeRenderRoot: boolean;
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
  activeFormIds: ReadonlyArray<string>;
  formTopologyComplete: boolean;
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
  constructionId: string;
  mountCallbackId: string | null;
  unmountCallbackId: string | null;
  updateCallbackId: string | null;
  resourceIds: ReadonlyArray<string>;
  schedulerIds: ReadonlyArray<string>;
  stateWriteIds: ReadonlyArray<string>;
  transitionIds: ReadonlyArray<string>;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactClassConstructionIssueKind {
  InvalidStateValue = "invalid-state-value",
  InvalidSuperCall = "invalid-super-call",
  MissingStateInitialization = "missing-state-initialization",
  MultipleStateInitializations = "multiple-state-initializations",
  SetStateCall = "set-state-call",
  SideEffect = "side-effect",
  UnsupportedConstructorStatement = "unsupported-constructor-statement",
  UnsupportedInitializer = "unsupported-initializer",
}

export enum ReactClassConstructionIssueStatus {
  Unknown = "unknown",
  Violated = "violated",
}

export enum ReactClassConstructionStatus {
  Invalid = "invalid",
  Unknown = "unknown",
  Valid = "valid",
}

export enum ReactClassStateInitializationKind {
  ConstructorAssignment = "constructor-assignment",
  Multiple = "multiple",
  None = "none",
  PublicField = "public-field",
}

export enum ReactClassStateInitializationRequirement {
  Conditional = "conditional",
  None = "none",
  Required = "required",
}

export interface ReactSemanticClassConstructionIssue {
  kind: ReactClassConstructionIssueKind;
  location: ReactProofLocation;
  status: ReactClassConstructionIssueStatus;
}

export interface ReactSemanticClassConstruction {
  id: string;
  ownerId: string;
  phase: ReactExecutionPhase.ClassConstruction;
  location: ReactProofLocation;
  constructorLocation: ReactProofLocation | null;
  initializationKind: ReactClassStateInitializationKind;
  initializationLocation: ReactProofLocation | null;
  stateRequirement: ReactClassStateInitializationRequirement;
  issues: ReadonlyArray<ReactSemanticClassConstructionIssue>;
  status: ReactClassConstructionStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactClassStateUpdaterStatus {
  Impure = "impure",
  Noop = "noop",
  Object = "object",
  Pure = "pure",
  Unknown = "unknown",
}

export enum ReactClassUpdateCycleStatus {
  Bounded = "bounded",
  Guaranteed = "guaranteed",
  None = "none",
  Unknown = "unknown",
}

export enum ReactClassStateWriteKind {
  Assignment = "assignment",
  Delete = "delete",
  MutatingCall = "mutating-call",
  ReferenceEscape = "reference-escape",
  Update = "update",
}

export enum ReactClassStateWriteStatus {
  Forbidden = "forbidden",
  Unknown = "unknown",
}

export interface ReactSemanticClassStateWrite {
  id: string;
  ownerId: string;
  callbackId: string;
  phase:
    | ReactExecutionPhase.ClassMount
    | ReactExecutionPhase.ClassUnmount
    | ReactExecutionPhase.ClassUpdate
    | ReactExecutionPhase.Deferred
    | ReactExecutionPhase.StateTransition;
  location: ReactProofLocation;
  kind: ReactClassStateWriteKind;
  status: ReactClassStateWriteStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactSemanticClassStateTransition {
  id: string;
  ownerId: string;
  lifecycleCallbackId: string;
  updaterCallbackId: string | null;
  phase: ReactExecutionPhase.ClassMount | ReactExecutionPhase.ClassUpdate;
  location: ReactProofLocation;
  guardLocations: ReadonlyArray<ReactProofLocation>;
  updaterStatus: ReactClassStateUpdaterStatus;
  cycleStatus: ReactClassUpdateCycleStatus;
  commitCallbackProvided: boolean;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactHookStateUpdaterStatus {
  DirectValue = "direct-value",
  Impure = "impure",
  Pure = "pure",
  SetterEscape = "setter-escape",
  Unknown = "unknown",
}

export interface ReactSemanticHookStateTransition {
  id: string;
  ownerId: string;
  stateName: string;
  setterName: string;
  location: ReactProofLocation;
  executionCallbackIds: ReadonlyArray<string>;
  updaterCallbackId: string | null;
  updaterStatus: ReactHookStateUpdaterStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactActionStateReducerStatus {
  Opaque = "opaque",
  Resolved = "resolved",
}

export enum ReactActionStateDispatchStatus {
  Action = "action",
  OutsideAction = "outside-action",
  Render = "render",
  SetterEscape = "setter-escape",
  Unknown = "unknown",
}

export enum ReactActionStateDispatchKind {
  ActionProp = "action-prop",
  Call = "call",
  Escape = "escape",
}

export interface ReactSemanticActionState {
  id: string;
  ownerId: string;
  stateName: string;
  dispatcherName: string;
  location: ReactProofLocation;
  reducerCallbackId: string | null;
  reducerStatus: ReactActionStateReducerStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactSemanticActionStateDispatch {
  id: string;
  ownerId: string;
  actionStateId: string;
  kind: ReactActionStateDispatchKind;
  location: ReactProofLocation;
  executionCallbackIds: ReadonlyArray<string>;
  status: ReactActionStateDispatchStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactFormActionKind {
  Form = "form",
  Submitter = "submitter",
}

export enum ReactFormActionStatus {
  Opaque = "opaque",
  Resolved = "resolved",
  UnsupportedControl = "unsupported-control",
}

export interface ReactSemanticFormAction {
  id: string;
  ownerId: string;
  kind: ReactFormActionKind;
  propName: string;
  location: ReactProofLocation;
  actionCallbackIds: ReadonlyArray<string>;
  status: ReactFormActionStatus;
  callbackComplete: boolean;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactFormStatusTopologyStatus {
  OutsideForm = "outside-form",
  Resolved = "resolved",
  Unknown = "unknown",
}

export interface ReactSemanticForm {
  id: string;
  ownerId: string;
  location: ReactProofLocation;
}

export interface ReactSemanticFormStatus {
  id: string;
  ownerId: string;
  location: ReactProofLocation;
  sourceFormIds: ReadonlyArray<string>;
  outsideForm: boolean;
  status: ReactFormStatusTopologyStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactOptimisticReducerStatus {
  Absent = "absent",
  Impure = "impure",
  Pure = "pure",
  Unknown = "unknown",
}

export enum ReactOptimisticActionStatus {
  Action = "action",
  OutsideAction = "outside-action",
  Render = "render",
  Unknown = "unknown",
}

export interface ReactSemanticOptimisticState {
  id: string;
  ownerId: string;
  stateName: string;
  setterName: string;
  location: ReactProofLocation;
  reducerCallbackId: string | null;
  reducerStatus: ReactOptimisticReducerStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export interface ReactSemanticOptimisticUpdate {
  id: string;
  ownerId: string;
  optimisticStateId: string;
  location: ReactProofLocation;
  executionCallbackIds: ReadonlyArray<string>;
  updaterCallbackId: string | null;
  updaterStatus: ReactHookStateUpdaterStatus;
  actionStatus: ReactOptimisticActionStatus;
  sourceComplete: boolean;
  complete: boolean;
}

export enum ReactTransitionStarterKind {
  Global = "global",
  Hook = "hook",
}

export enum ReactTransitionActionStatus {
  Async = "async",
  ControlledInput = "controlled-input",
  Opaque = "opaque",
  StarterEscape = "starter-escape",
  Synchronous = "synchronous",
  UnknownControl = "unknown-control",
}

export interface ReactSemanticTransitionAction {
  id: string;
  ownerId: string;
  starterKind: ReactTransitionStarterKind;
  location: ReactProofLocation;
  executionCallbackIds: ReadonlyArray<string>;
  actionCallbackId: string | null;
  controlledStateNames: ReadonlyArray<string>;
  unknownControlStateNames: ReadonlyArray<string>;
  status: ReactTransitionActionStatus;
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
  actionStates: ReadonlyArray<ReactSemanticActionState>;
  actionStateDispatches: ReadonlyArray<ReactSemanticActionStateDispatch>;
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
  classConstructions: ReadonlyArray<ReactSemanticClassConstruction>;
  classLifecycles: ReadonlyArray<ReactSemanticClassLifecycle>;
  classStateWrites: ReadonlyArray<ReactSemanticClassStateWrite>;
  classStateTransitions: ReadonlyArray<ReactSemanticClassStateTransition>;
  formActions: ReadonlyArray<ReactSemanticFormAction>;
  forms: ReadonlyArray<ReactSemanticForm>;
  formStatuses: ReadonlyArray<ReactSemanticFormStatus>;
  hookStateTransitions: ReadonlyArray<ReactSemanticHookStateTransition>;
  optimisticStates: ReadonlyArray<ReactSemanticOptimisticState>;
  optimisticUpdates: ReadonlyArray<ReactSemanticOptimisticUpdate>;
  transitionActions: ReadonlyArray<ReactSemanticTransitionAction>;
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
  classComponentBase?: ReactClassComponentBase;
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
