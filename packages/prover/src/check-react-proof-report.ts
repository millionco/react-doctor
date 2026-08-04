import {
  REACT_CONTEXT_DEFAULT_SOURCE_ID,
  REACT_CONTEXT_UNKNOWN_SOURCE_ID,
  REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID,
  REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID,
  REACT_FORM_OUTSIDE_SOURCE_ID,
  REACT_FORM_UNKNOWN_SOURCE_ID,
  REACT_HYDRATABLE_SERVER_API_NAMES,
  REACT_PROOF_SCHEMA_VERSION,
  REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
  REACT_STATIC_SERVER_API_NAMES,
  REACT_SUSPENSE_OUTSIDE_SOURCE_ID,
  REACT_SUSPENSE_UNKNOWN_SOURCE_ID,
} from "./constants.js";
import {
  ReactActionStateDispatchKind,
  ReactActionStateDispatchStatus,
  ReactActionStateReducerStatus,
  ReactAppProofStatus,
  ReactAsyncOwnershipStatus,
  ReactCallableRefFreshness,
  ReactClassComponentBase,
  ReactClassConstructionIssueKind,
  ReactClassConstructionIssueStatus,
  ReactClassConstructionStatus,
  ReactClassStateInitializationKind,
  ReactClassStateInitializationRequirement,
  ReactClassStateUpdaterStatus,
  ReactClassStateWriteKind,
  ReactClassStateWriteStatus,
  ReactClassUpdateCycleStatus,
  ReactEffectResourceDisposalStatus,
  ReactEffectResourceKind,
  ReactEffectDependencyMode,
  ReactErrorBoundaryCoverageStatus,
  ReactErrorBoundaryProtocolStatus,
  ReactExecutionPhase,
  ReactFormActionKind,
  ReactFormActionStatus,
  ReactFormStatusTopologyStatus,
  ReactHostControlKind,
  ReactHostControlMutabilityStatus,
  ReactHostControlStatus,
  ReactHostControlUpdateStatus,
  ReactHostControlValueStatus,
  ReactHookStateUpdaterStatus,
  ReactHydrationHazardKind,
  ReactHydrationPrefixStatus,
  ReactHydrationRootKind,
  ReactHydrationRootExecutionStatus,
  ReactHydrationStatus,
  ReactImperativeHandleRefKind,
  ReactImperativeHandleStatus,
  ReactLazyDeclarationStatus,
  ReactLazyLoaderStatus,
  ReactMemoComparatorKind,
  ReactMemoComparatorStatus,
  ReactObligationStatus,
  ReactOptimisticActionStatus,
  ReactOptimisticReducerStatus,
  ReactProofCertificateStatus,
  ReactProofClaim,
  ReactReducerDispatchKind,
  ReactReducerDispatchStatus,
  ReactReducerPurityStatus,
  ReactReducerReturnStatus,
  ReactRenderFailureKind,
  ReactSchedulerCancellationStatus,
  ReactSemanticCallbackKind,
  ReactSemanticEdgeKind,
  ReactSemanticFunctionCallKind,
  ReactSemanticRenderKind,
  ReactSuspenseCoverageStatus,
  ReactTransitionActionStatus,
  ReactTransitionStarterKind,
  ReactUnitKind,
  ReactUseResourceIdentityStatus,
  ReactUseResourceKind,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import type {
  ReactAppProofReport,
  ReactProofCertificateCheck,
  ReactProofCertificateFailure,
  ReactSemanticHostControl,
  ReactSemanticUnit,
} from "./types.js";

const HOOK_STATE_UPDATER_STATUSES = new Set(Object.values(ReactHookStateUpdaterStatus));
const ACTION_STATE_DISPATCH_STATUSES = new Set(Object.values(ReactActionStateDispatchStatus));
const ACTION_STATE_DISPATCH_KINDS = new Set(Object.values(ReactActionStateDispatchKind));
const ACTION_STATE_REDUCER_STATUSES = new Set(Object.values(ReactActionStateReducerStatus));
const FORM_ACTION_KINDS = new Set(Object.values(ReactFormActionKind));
const FORM_ACTION_STATUSES = new Set(Object.values(ReactFormActionStatus));
const HOST_CONTROL_KINDS = new Set(Object.values(ReactHostControlKind));
const HOST_CONTROL_MUTABILITY_STATUSES = new Set(Object.values(ReactHostControlMutabilityStatus));
const HOST_CONTROL_STATUSES = new Set(Object.values(ReactHostControlStatus));
const HOST_CONTROL_UPDATE_STATUSES = new Set(Object.values(ReactHostControlUpdateStatus));
const HOST_CONTROL_VALUE_STATUSES = new Set(Object.values(ReactHostControlValueStatus));
const HYDRATION_HAZARD_KINDS = new Set(Object.values(ReactHydrationHazardKind));
const HYDRATION_PREFIX_STATUSES = new Set(Object.values(ReactHydrationPrefixStatus));
const HYDRATION_ROOT_KINDS = new Set(Object.values(ReactHydrationRootKind));
const HYDRATION_ROOT_EXECUTION_STATUSES = new Set(Object.values(ReactHydrationRootExecutionStatus));
const HYDRATION_STATUSES = new Set(Object.values(ReactHydrationStatus));
const MEMO_COMPARATOR_KINDS = new Set(Object.values(ReactMemoComparatorKind));
const MEMO_COMPARATOR_STATUSES = new Set(Object.values(ReactMemoComparatorStatus));
const OPTIMISTIC_ACTION_STATUSES = new Set(Object.values(ReactOptimisticActionStatus));
const OPTIMISTIC_REDUCER_STATUSES = new Set(Object.values(ReactOptimisticReducerStatus));
const TRANSITION_ACTION_STATUSES = new Set(Object.values(ReactTransitionActionStatus));
const TRANSITION_STARTER_KINDS = new Set(Object.values(ReactTransitionStarterKind));
const IMPERATIVE_HANDLE_REF_KINDS = new Set(Object.values(ReactImperativeHandleRefKind));
const IMPERATIVE_HANDLE_STATUSES = new Set(Object.values(ReactImperativeHandleStatus));
const ERROR_BOUNDARY_COVERAGE_STATUSES = new Set(Object.values(ReactErrorBoundaryCoverageStatus));
const ERROR_BOUNDARY_PROTOCOL_STATUSES = new Set(Object.values(ReactErrorBoundaryProtocolStatus));
const RENDER_FAILURE_KINDS = new Set(Object.values(ReactRenderFailureKind));
const LAZY_DECLARATION_STATUSES = new Set(Object.values(ReactLazyDeclarationStatus));
const LAZY_LOADER_STATUSES = new Set(Object.values(ReactLazyLoaderStatus));
const REDUCER_DISPATCH_KINDS = new Set(Object.values(ReactReducerDispatchKind));
const REDUCER_DISPATCH_STATUSES = new Set(Object.values(ReactReducerDispatchStatus));
const REDUCER_PURITY_STATUSES = new Set(Object.values(ReactReducerPurityStatus));
const REDUCER_RETURN_STATUSES = new Set(Object.values(ReactReducerReturnStatus));
const SUSPENSE_COVERAGE_STATUSES = new Set(Object.values(ReactSuspenseCoverageStatus));
const USE_RESOURCE_IDENTITY_STATUSES = new Set(Object.values(ReactUseResourceIdentityStatus));
const USE_RESOURCE_KINDS = new Set(Object.values(ReactUseResourceKind));
const OBLIGATION_STATUSES = new Set(Object.values(ReactObligationStatus));
const TRANSITION_ACTION_ORIGIN_PHASES = new Set([
  ReactExecutionPhase.ActionStateReducer,
  ReactExecutionPhase.ClassMount,
  ReactExecutionPhase.ClassUpdate,
  ReactExecutionPhase.Deferred,
  ReactExecutionPhase.EffectCleanup,
  ReactExecutionPhase.EffectEvent,
  ReactExecutionPhase.EffectSetup,
  ReactExecutionPhase.Event,
  ReactExecutionPhase.ExternalStoreSubscription,
  ReactExecutionPhase.FormAction,
  ReactExecutionPhase.TransitionAction,
]);

const addFailure = (
  failures: ReactProofCertificateFailure[],
  subjectId: string,
  description: string,
): void => {
  failures.push({ description, subjectId });
};

interface CheckedHydrationSourceSet {
  rootIds: Set<string>;
  hasUnknownSource: boolean;
}

interface ExpectedHydrationProtocol {
  clientRootIds: ReadonlyArray<string>;
  interactiveServerRootIds: ReadonlyArray<string>;
  staticServerRootIds: ReadonlyArray<string>;
  hazardIds: ReadonlyArray<string>;
  status: ReactHydrationStatus;
  sourceComplete: boolean;
  complete: boolean;
}

const addCheckedHydrationSource = (
  sourcesByUnit: Map<string, CheckedHydrationSourceSet>,
  unitId: string,
  rootId: string,
): boolean => {
  let sources = sourcesByUnit.get(unitId);
  if (!sources) {
    sources = { rootIds: new Set(), hasUnknownSource: false };
    sourcesByUnit.set(unitId, sources);
  }
  const previousSize = sources.rootIds.size;
  sources.rootIds.add(rootId);
  return sources.rootIds.size !== previousSize;
};

const addCheckedUnknownHydrationSource = (
  sourcesByUnit: Map<string, CheckedHydrationSourceSet>,
  unitId: string,
): boolean => {
  let sources = sourcesByUnit.get(unitId);
  if (!sources) {
    sources = { rootIds: new Set(), hasUnknownSource: false };
    sourcesByUnit.set(unitId, sources);
  }
  if (sources.hasUnknownSource) return false;
  sources.hasUnknownSource = true;
  return true;
};

const deriveHydrationSourcesByUnit = (
  report: ReactAppProofReport,
): ReadonlyMap<string, CheckedHydrationSourceSet> => {
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const sourcesByUnit = new Map<string, CheckedHydrationSourceSet>();
  for (const root of report.graph.hydrationRoots) {
    if (root.targetId) addCheckedHydrationSource(sourcesByUnit, root.targetId, root.id);
  }
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of report.graph.renders) {
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
      const ownerSources = sourcesByUnit.get(render.ownerId);
      if (!ownerSources) continue;
      for (const rootId of ownerSources.rootIds) {
        didSourcesChange =
          addCheckedHydrationSource(sourcesByUnit, render.targetId, rootId) || didSourcesChange;
      }
      if (ownerSources.hasUnknownSource) {
        didSourcesChange =
          addCheckedUnknownHydrationSource(sourcesByUnit, render.targetId) || didSourcesChange;
      }
    }
    for (const edge of report.graph.edges) {
      if (edge.kind !== ReactSemanticEdgeKind.CallsHook || !unitIds.has(edge.targetId)) continue;
      const ownerSources = sourcesByUnit.get(edge.sourceId);
      if (!ownerSources) continue;
      for (const rootId of ownerSources.rootIds) {
        didSourcesChange =
          addCheckedHydrationSource(sourcesByUnit, edge.targetId, rootId) || didSourcesChange;
      }
      if (ownerSources.hasUnknownSource) {
        didSourcesChange =
          addCheckedUnknownHydrationSource(sourcesByUnit, edge.targetId) || didSourcesChange;
      }
    }
    for (const slotFlow of report.graph.slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (!sourceRender || !sourcesByUnit.has(sourceRender.ownerId)) continue;
      didSourcesChange =
        addCheckedUnknownHydrationSource(sourcesByUnit, sourceRender.targetId) || didSourcesChange;
    }
  }
  return sourcesByUnit;
};

const expectedHydrationProtocol = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
  hydrationSourcesByUnit: ReadonlyMap<string, CheckedHydrationSourceSet>,
): ExpectedHydrationProtocol => {
  const rootsById = new Map(report.graph.hydrationRoots.map((root) => [root.id, root]));
  const sources = hydrationSourcesByUnit.get(unit.id);
  const sourceRoots = [...(sources?.rootIds ?? [])]
    .map((rootId) => rootsById.get(rootId))
    .filter((root): root is (typeof report.graph.hydrationRoots)[number] => Boolean(root));
  const clientRoots = sourceRoots.filter((root) => root.kind === ReactHydrationRootKind.Client);
  const interactiveServerRoots = sourceRoots.filter(
    (root) => root.kind === ReactHydrationRootKind.ServerInteractive,
  );
  const staticServerRoots = sourceRoots.filter(
    (root) => root.kind === ReactHydrationRootKind.ServerStatic,
  );
  const hazardIds = report.graph.hydrationHazards.flatMap((hazard) =>
    hazard.ownerId === unit.id ? [hazard.id] : [],
  );
  const hasIncompleteRoot = report.graph.hydrationRoots.some((root) => !root.sourceComplete);
  const hasClientRoot = report.graph.hydrationRoots.some(
    (root) => root.kind === ReactHydrationRootKind.Client,
  );
  let status = ReactHydrationStatus.Unknown;
  if (!hasClientRoot) {
    status = ReactHydrationStatus.NotHydrated;
  } else if (hasIncompleteRoot) {
    status = ReactHydrationStatus.Unknown;
  } else if (sourceRoots.length === 0) {
    status = ReactHydrationStatus.NotHydrated;
  } else if (
    !hasIncompleteRoot &&
    !sources?.hasUnknownSource &&
    clientRoots.length === 1 &&
    interactiveServerRoots.length === 1 &&
    staticServerRoots.length === 0
  ) {
    status =
      clientRoots[0]?.identifierPrefix === interactiveServerRoots[0]?.identifierPrefix &&
      hazardIds.length === 0
        ? ReactHydrationStatus.Equivalent
        : ReactHydrationStatus.Mismatched;
  } else if (
    !hasIncompleteRoot &&
    !sources?.hasUnknownSource &&
    clientRoots.length === 1 &&
    interactiveServerRoots.length === 0 &&
    staticServerRoots.length === 1
  ) {
    status = ReactHydrationStatus.Mismatched;
  }
  const sourceComplete =
    status === ReactHydrationStatus.NotHydrated ||
    (!hasIncompleteRoot && !sources?.hasUnknownSource && status !== ReactHydrationStatus.Unknown);
  return {
    clientRootIds: clientRoots.map((root) => root.id),
    interactiveServerRootIds: interactiveServerRoots.map((root) => root.id),
    staticServerRootIds: staticServerRoots.map((root) => root.id),
    hazardIds,
    status,
    sourceComplete,
    complete:
      sourceComplete &&
      (status === ReactHydrationStatus.Equivalent || status === ReactHydrationStatus.NotHydrated),
  };
};

const checkUniqueIds = (
  failures: ReactProofCertificateFailure[],
  collectionName: string,
  ids: ReadonlyArray<string>,
): void => {
  const seenIds = new Set<string>();
  for (const id of ids) {
    if (seenIds.has(id)) {
      addFailure(failures, id, `${collectionName} contains a duplicate semantic ID`);
    }
    seenIds.add(id);
  }
};

const expectedAsyncOwnershipStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const tasks = report.graph.asyncTasks.filter((task) => task.ownerId === unit.id);
  if (tasks.some((task) => task.ownershipStatus === ReactAsyncOwnershipStatus.Unguarded)) {
    return ReactObligationStatus.Violated;
  }
  if (tasks.some((task) => task.ownershipStatus === ReactAsyncOwnershipStatus.Unknown)) {
    return ReactObligationStatus.Unknown;
  }
  return ReactObligationStatus.Proved;
};

const expectedCallableRefFreshnessStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  return report.graph.callableRefs
    .filter((callableRef) => callableRef.ownerId === unit.id)
    .some((callableRef) => !callableRef.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedClassStateTransitionStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  if (unit.kind !== ReactUnitKind.ClassComponent) {
    return ReactObligationStatus.Proved;
  }
  const transitions = report.graph.classStateTransitions.filter(
    (transition) => transition.ownerId === unit.id,
  );
  const stateWrites = report.graph.classStateWrites.filter(
    (stateWrite) => stateWrite.ownerId === unit.id,
  );
  if (
    stateWrites.some((stateWrite) => stateWrite.status === ReactClassStateWriteStatus.Forbidden)
  ) {
    return ReactObligationStatus.Violated;
  }
  if (
    transitions.some(
      (transition) =>
        transition.updaterStatus === ReactClassStateUpdaterStatus.Impure ||
        transition.cycleStatus === ReactClassUpdateCycleStatus.Guaranteed,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  const lifecycle = report.graph.classLifecycles.find((candidate) => candidate.ownerId === unit.id);
  return !lifecycle?.sourceComplete ||
    stateWrites.some((stateWrite) => !stateWrite.complete) ||
    transitions.some((transition) => !transition.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedClassConstructionStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  if (unit.kind !== ReactUnitKind.ClassComponent) {
    return ReactObligationStatus.Proved;
  }
  const construction = report.graph.classConstructions.find(
    (candidate) => candidate.ownerId === unit.id,
  );
  if (construction?.status === ReactClassConstructionStatus.Invalid) {
    return ReactObligationStatus.Violated;
  }
  return !construction || construction.status === ReactClassConstructionStatus.Unknown
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedHookStateTransitionStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  if (unit.kind === ReactUnitKind.ClassComponent) {
    return ReactObligationStatus.Proved;
  }
  const transitions = report.graph.hookStateTransitions.filter(
    (transition) => transition.ownerId === unit.id,
  );
  if (
    transitions.some(
      (transition) => transition.updaterStatus === ReactHookStateUpdaterStatus.Impure,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return transitions.some((transition) => !transition.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedLazySuspenseStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const lazyRenders = report.graph.lazyRenders.filter((render) => render.ownerId === unit.id);
  const renderedComponentIds = new Set(lazyRenders.map((render) => render.lazyComponentId));
  const lazyComponents = report.graph.lazyComponents.filter(
    (component) =>
      component.declarationOwnerId === unit.id ||
      renderedComponentIds.has(component.id) ||
      (!component.identityResolved && !component.declarationOwnerId && unit.canBeRenderRoot),
  );
  if (
    lazyComponents.some(
      (component) =>
        component.declarationStatus === ReactLazyDeclarationStatus.RenderUnstable ||
        component.loaderStatus === ReactLazyLoaderStatus.Invalid,
    ) ||
    lazyRenders.some(
      (render) => render.coverageStatus === ReactSuspenseCoverageStatus.OutsideBoundary,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return lazyComponents.some(
    (component) =>
      !component.identityResolved || component.loaderStatus === ReactLazyLoaderStatus.Opaque,
  ) || lazyRenders.some((render) => render.coverageStatus === ReactSuspenseCoverageStatus.Unknown)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedErrorBoundaryStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const definitions = report.graph.errorBoundaryDefinitions.filter(
    (definition) => definition.ownerId === unit.id,
  );
  const failures = report.graph.renderFailures.filter((failure) => failure.ownerId === unit.id);
  if (
    definitions.some(
      (definition) =>
        definition.derivedStateStatus === ReactErrorBoundaryProtocolStatus.Invalid ||
        definition.fallbackRenderStatus === ReactErrorBoundaryProtocolStatus.Invalid,
    ) ||
    failures.some(
      (failure) => failure.coverageStatus === ReactErrorBoundaryCoverageStatus.OutsideBoundary,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return definitions.some((definition) => !definition.complete) ||
    failures.some((failure) => failure.coverageStatus === ReactErrorBoundaryCoverageStatus.Unknown)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedUseResourceStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const resources = report.graph.useResources.filter((resource) => resource.ownerId === unit.id);
  if (
    resources.some(
      (resource) =>
        resource.kind === ReactUseResourceKind.Invalid ||
        resource.identityStatus === ReactUseResourceIdentityStatus.Unstable ||
        resource.suspenseCoverageStatus === ReactSuspenseCoverageStatus.OutsideBoundary ||
        resource.errorCoverageStatus === ReactErrorBoundaryCoverageStatus.OutsideBoundary,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return resources.some((resource) => !resource.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedHostControlProtocolStatus = (
  control: ReactSemanticHostControl,
): ReactHostControlStatus => {
  if (
    control.kind === ReactHostControlKind.Unknown ||
    control.controlledPropPresent === null ||
    control.defaultPropPresent === null ||
    (control.controlledPropPresent &&
      (control.kind === ReactHostControlKind.FileInput ||
        control.kind === ReactHostControlKind.SelectMultiple))
  ) {
    return ReactHostControlStatus.Unknown;
  }
  if (
    (control.controlledPropPresent && control.defaultPropPresent) ||
    control.valueStatus === ReactHostControlValueStatus.MaySwitch ||
    control.valueStatus === ReactHostControlValueStatus.Nullish
  ) {
    return ReactHostControlStatus.Invalid;
  }
  if (
    control.valueStatus === ReactHostControlValueStatus.Unknown ||
    control.updateStatus === ReactHostControlUpdateStatus.Opaque ||
    (control.controlledPropPresent &&
      control.mutabilityStatus === ReactHostControlMutabilityStatus.Unknown &&
      control.updateStatus !== ReactHostControlUpdateStatus.Exact)
  ) {
    return ReactHostControlStatus.Unknown;
  }
  if (
    control.updateStatus === ReactHostControlUpdateStatus.Conditional ||
    control.updateStatus === ReactHostControlUpdateStatus.Deferred ||
    control.updateStatus === ReactHostControlUpdateStatus.Missing ||
    control.updateStatus === ReactHostControlUpdateStatus.WrongValue
  ) {
    return ReactHostControlStatus.Invalid;
  }
  return ReactHostControlStatus.Resolved;
};

const expectedHostControlStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const controls = report.graph.hostControls.filter((control) => control.ownerId === unit.id);
  if (controls.some((control) => control.status === ReactHostControlStatus.Invalid)) {
    return ReactObligationStatus.Violated;
  }
  return controls.some((control) => !control.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedHydrationStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const hydration = report.graph.hydrations.find((candidate) => candidate.ownerId === unit.id);
  if (!hydration || hydration.status === ReactHydrationStatus.Unknown) {
    return ReactObligationStatus.Unknown;
  }
  return hydration.status === ReactHydrationStatus.Mismatched
    ? ReactObligationStatus.Violated
    : ReactObligationStatus.Proved;
};

const isMemoObservationCovered = (
  observationPath: string,
  equalPropPaths: ReadonlyArray<string>,
): boolean =>
  equalPropPaths.some(
    (equalPropPath) =>
      equalPropPath.length === 0 ||
      equalPropPath === observationPath ||
      (observationPath !== "*" && observationPath.startsWith(`${equalPropPath}.`)),
  );

const expectedMemoComparatorStatus = (
  comparator: ReactAppProofReport["graph"]["memoComparators"][number],
): ReactMemoComparatorStatus => {
  if (!comparator.ownerId) return ReactMemoComparatorStatus.Unknown;
  if (comparator.kind === ReactMemoComparatorKind.DefaultShallow) {
    return ReactMemoComparatorStatus.Equivalent;
  }
  for (const truePath of comparator.truePaths) {
    if (!truePath.sourceComplete) continue;
    if (
      comparator.observations.some(
        (observation) =>
          observation.valueCanVary &&
          !isMemoObservationCovered(observation.path, truePath.equalPropPaths),
      )
    ) {
      return ReactMemoComparatorStatus.OmittedObservedProp;
    }
  }
  const hasUniversalTruePaths =
    comparator.truePaths.length > 0 &&
    comparator.truePaths.every(
      (truePath) => truePath.sourceComplete && truePath.equalPropPaths.includes(""),
    );
  return comparator.analysisComplete &&
    comparator.truePaths.every((truePath) => truePath.sourceComplete) &&
    (comparator.observationComplete || hasUniversalTruePaths)
    ? ReactMemoComparatorStatus.Equivalent
    : ReactMemoComparatorStatus.Unknown;
};

const expectedMemoEquivalenceStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const comparators = report.graph.memoComparators.filter(
    (comparator) => comparator.ownerId === unit.id,
  );
  if (
    comparators.some(
      (comparator) => comparator.status === ReactMemoComparatorStatus.OmittedObservedProp,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return comparators.some((comparator) => !comparator.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedReducerPurityStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  if (unit.kind === ReactUnitKind.ClassComponent) {
    return ReactObligationStatus.Proved;
  }
  const reducers = report.graph.reducers.filter((reducer) => reducer.ownerId === unit.id);
  if (
    reducers.some(
      (reducer) =>
        reducer.reducerPurity === ReactReducerPurityStatus.Impure ||
        reducer.initializerPurity === ReactReducerPurityStatus.Impure,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return reducers.some(
    (reducer) =>
      reducer.reducerPurity === ReactReducerPurityStatus.Opaque ||
      reducer.initializerPurity === ReactReducerPurityStatus.Opaque,
  )
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedReducerTransitionStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  if (unit.kind === ReactUnitKind.ClassComponent) {
    return ReactObligationStatus.Proved;
  }
  const reducers = report.graph.reducers.filter((reducer) => reducer.ownerId === unit.id);
  const dispatches = report.graph.reducerDispatches.filter(
    (dispatch) => dispatch.ownerId === unit.id,
  );
  if (
    reducers.some(
      (reducer) =>
        reducer.reducerPurity === ReactReducerPurityStatus.Impure ||
        reducer.initializerPurity === ReactReducerPurityStatus.Impure ||
        reducer.reducerReturnStatus === ReactReducerReturnStatus.MayFallThrough ||
        reducer.reducerReturnStatus === ReactReducerReturnStatus.MayThrow ||
        reducer.initializerReturnStatus === ReactReducerReturnStatus.MayFallThrough ||
        reducer.initializerReturnStatus === ReactReducerReturnStatus.MayThrow,
    ) ||
    dispatches.some(
      (dispatch) =>
        dispatch.status === ReactReducerDispatchStatus.Render ||
        dispatch.status === ReactReducerDispatchStatus.Reducer,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return reducers.some((reducer) => !reducer.complete) ||
    dispatches.some((dispatch) => !dispatch.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedImperativeHandleStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const handles = report.graph.imperativeHandles.filter((handle) => handle.ownerId === unit.id);
  if (
    handles.some(
      (handle) =>
        handle.status === ReactImperativeHandleStatus.ImpureFactory ||
        handle.status === ReactImperativeHandleStatus.MissingDependency,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return handles.some((handle) => !handle.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedTransitionActionStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const actions = report.graph.transitionActions.filter((action) => action.ownerId === unit.id);
  if (actions.some((action) => action.status === ReactTransitionActionStatus.ControlledInput)) {
    return ReactObligationStatus.Violated;
  }
  return actions.some((action) => !action.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedActionStateStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const states = report.graph.actionStates.filter((state) => state.ownerId === unit.id);
  const dispatches = report.graph.actionStateDispatches.filter(
    (dispatch) => dispatch.ownerId === unit.id,
  );
  if (
    dispatches.some(
      (dispatch) =>
        dispatch.status === ReactActionStateDispatchStatus.OutsideAction ||
        dispatch.status === ReactActionStateDispatchStatus.Render,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return states.some((state) => !state.complete) ||
    dispatches.some((dispatch) => !dispatch.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedFormActionStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const actions = report.graph.formActions.filter((action) => action.ownerId === unit.id);
  if (actions.some((action) => action.status === ReactFormActionStatus.UnsupportedControl)) {
    return ReactObligationStatus.Violated;
  }
  return actions.some((action) => !action.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedFormStatusStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const formStatuses = report.graph.formStatuses.filter(
    (formStatus) => formStatus.ownerId === unit.id,
  );
  if (
    formStatuses.some(
      (formStatus) => formStatus.status === ReactFormStatusTopologyStatus.OutsideForm,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return formStatuses.some((formStatus) => !formStatus.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedOptimisticStateStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const states = report.graph.optimisticStates.filter((state) => state.ownerId === unit.id);
  const updates = report.graph.optimisticUpdates.filter((update) => update.ownerId === unit.id);
  if (
    states.some((state) => state.reducerStatus === ReactOptimisticReducerStatus.Impure) ||
    updates.some(
      (update) =>
        update.actionStatus === ReactOptimisticActionStatus.OutsideAction ||
        update.actionStatus === ReactOptimisticActionStatus.Render ||
        update.updaterStatus === ReactHookStateUpdaterStatus.Impure,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  return states.some((state) => !state.complete) || updates.some((update) => !update.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedReactNodeFlowStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  return report.graph.slotFlows
    .filter((slotFlow) => slotFlow.ownerId === unit.id)
    .some((slotFlow) => !slotFlow.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedScheduledCallbackLifetimeStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const schedulers = report.graph.schedulers.filter((scheduler) => scheduler.ownerId === unit.id);
  if (
    schedulers.some(
      (scheduler) => scheduler.cancellationStatus === ReactSchedulerCancellationStatus.Missing,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  if (
    unit.kind === ReactUnitKind.ClassComponent &&
    !report.graph.classLifecycles.find((lifecycle) => lifecycle.ownerId === unit.id)?.sourceComplete
  ) {
    return ReactObligationStatus.Unknown;
  }
  return schedulers.some((scheduler) => !scheduler.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const expectedEffectCleanupStatus = (
  unit: ReactSemanticUnit,
  report: ReactAppProofReport,
): ReactObligationStatus => {
  if (!unit.sourceComplete || unit.kind === ReactUnitKind.InvalidHookOwner) {
    return ReactObligationStatus.Unknown;
  }
  const resources = report.graph.resources.filter((resource) => resource.ownerId === unit.id);
  if (
    resources.some(
      (resource) => resource.disposalStatus === ReactEffectResourceDisposalStatus.Missing,
    )
  ) {
    return ReactObligationStatus.Violated;
  }
  if (
    unit.kind === ReactUnitKind.ClassComponent &&
    !report.graph.classLifecycles.find((lifecycle) => lifecycle.ownerId === unit.id)?.sourceComplete
  ) {
    return ReactObligationStatus.Unknown;
  }
  if (
    report.graph.effects.some((effect) => effect.ownerId === unit.id && !effect.callbackResolved)
  ) {
    return ReactObligationStatus.Unknown;
  }
  return resources.some((resource) => !resource.complete)
    ? ReactObligationStatus.Unknown
    : ReactObligationStatus.Proved;
};

const checkClaimCoverage = (
  report: ReactAppProofReport,
  failures: ReactProofCertificateFailure[],
): void => {
  const expectedClaims = Object.values(ReactProofClaim);
  for (const semanticUnit of report.graph.units) {
    const unitProof = report.units.find(
      (unit) =>
        unit.name === semanticUnit.name &&
        unit.location.filePath === semanticUnit.location.filePath &&
        unit.location.line === semanticUnit.location.line &&
        unit.location.column === semanticUnit.location.column,
    );
    if (!unitProof) {
      addFailure(failures, semanticUnit.id, "The semantic unit has no proof record");
      continue;
    }
    for (const claim of expectedClaims) {
      const matchingObligations = unitProof.obligations.filter(
        (obligation) => obligation.claim === claim,
      );
      if (matchingObligations.length !== 1) {
        addFailure(failures, semanticUnit.id, `${claim} must have exactly one proof obligation`);
      }
    }
    const actionState = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ActionState,
    );
    const expectedActionStatus = expectedActionStateStatus(semanticUnit, report);
    if (actionState && actionState.status !== expectedActionStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Action State facts require ${expectedActionStatus}, not ${actionState.status}`,
      );
    }
    const asyncOwnership = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.AsyncEffectOwnership,
    );
    const expectedStatus = expectedAsyncOwnershipStatus(semanticUnit, report);
    if (asyncOwnership && asyncOwnership.status !== expectedStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Async Effect ownership facts require ${expectedStatus}, not ${asyncOwnership.status}`,
      );
    }
    const callableRefFreshness = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.CallableRefFreshness,
    );
    const expectedCallableRefStatus = expectedCallableRefFreshnessStatus(semanticUnit, report);
    if (callableRefFreshness && callableRefFreshness.status !== expectedCallableRefStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Callable ref facts require ${expectedCallableRefStatus}, not ${callableRefFreshness.status}`,
      );
    }
    const classStateTransitions = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassStateTransitions,
    );
    const expectedClassStateStatus = expectedClassStateTransitionStatus(semanticUnit, report);
    if (classStateTransitions && classStateTransitions.status !== expectedClassStateStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Class state transition facts require ${expectedClassStateStatus}, not ${classStateTransitions.status}`,
      );
    }
    const classConstruction = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ClassConstruction,
    );
    const expectedConstructionStatus = expectedClassConstructionStatus(semanticUnit, report);
    if (classConstruction && classConstruction.status !== expectedConstructionStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Class construction facts require ${expectedConstructionStatus}, not ${classConstruction.status}`,
      );
    }
    const hookStateTransitions = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.HookStateTransitions,
    );
    const expectedHookStateStatus = expectedHookStateTransitionStatus(semanticUnit, report);
    if (hookStateTransitions && hookStateTransitions.status !== expectedHookStateStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Hook state transition facts require ${expectedHookStateStatus}, not ${hookStateTransitions.status}`,
      );
    }
    const reducerPurity = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ReducerPurity,
    );
    const expectedPurityStatus = expectedReducerPurityStatus(semanticUnit, report);
    if (reducerPurity && reducerPurity.status !== expectedPurityStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Reducer purity facts require ${expectedPurityStatus}, not ${reducerPurity.status}`,
      );
    }
    const reducerTransitions = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ReducerTransitions,
    );
    const expectedReducerStatus = expectedReducerTransitionStatus(semanticUnit, report);
    if (reducerTransitions && reducerTransitions.status !== expectedReducerStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Reducer transition facts require ${expectedReducerStatus}, not ${reducerTransitions.status}`,
      );
    }
    const imperativeHandle = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ImperativeHandle,
    );
    const expectedHandleStatus = expectedImperativeHandleStatus(semanticUnit, report);
    if (imperativeHandle && imperativeHandle.status !== expectedHandleStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Imperative handle facts require ${expectedHandleStatus}, not ${imperativeHandle.status}`,
      );
    }
    const lazySuspense = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.LazySuspense,
    );
    const expectedLazyStatus = expectedLazySuspenseStatus(semanticUnit, report);
    if (lazySuspense && lazySuspense.status !== expectedLazyStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Lazy Suspense facts require ${expectedLazyStatus}, not ${lazySuspense.status}`,
      );
    }
    const errorBoundary = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ErrorBoundary,
    );
    const expectedErrorStatus = expectedErrorBoundaryStatus(semanticUnit, report);
    if (errorBoundary && errorBoundary.status !== expectedErrorStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Error Boundary facts require ${expectedErrorStatus}, not ${errorBoundary.status}`,
      );
    }
    const useResource = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.UseResource,
    );
    const expectedResourceStatus = expectedUseResourceStatus(semanticUnit, report);
    if (useResource && useResource.status !== expectedResourceStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `use resource facts require ${expectedResourceStatus}, not ${useResource.status}`,
      );
    }
    const hostControl = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.HostControl,
    );
    const expectedControlStatus = expectedHostControlStatus(semanticUnit, report);
    if (hostControl && hostControl.status !== expectedControlStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Host control facts require ${expectedControlStatus}, not ${hostControl.status}`,
      );
    }
    const hydrationEquivalence = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.HydrationEquivalence,
    );
    const expectedHydrationEquivalenceStatus = expectedHydrationStatus(semanticUnit, report);
    if (
      hydrationEquivalence &&
      hydrationEquivalence.status !== expectedHydrationEquivalenceStatus
    ) {
      addFailure(
        failures,
        semanticUnit.id,
        `Hydration facts require ${expectedHydrationEquivalenceStatus}, not ${hydrationEquivalence.status}`,
      );
    }
    const memoEquivalence = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.MemoEquivalence,
    );
    const expectedMemoStatus = expectedMemoEquivalenceStatus(semanticUnit, report);
    if (memoEquivalence && memoEquivalence.status !== expectedMemoStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Memo comparator facts require ${expectedMemoStatus}, not ${memoEquivalence.status}`,
      );
    }
    const transitionActions = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.TransitionActions,
    );
    const expectedTransitionStatus = expectedTransitionActionStatus(semanticUnit, report);
    if (transitionActions && transitionActions.status !== expectedTransitionStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Transition Action facts require ${expectedTransitionStatus}, not ${transitionActions.status}`,
      );
    }
    const formActions = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.FormActions,
    );
    const expectedFormStatus = expectedFormActionStatus(semanticUnit, report);
    if (formActions && formActions.status !== expectedFormStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Form Action facts require ${expectedFormStatus}, not ${formActions.status}`,
      );
    }
    const formStatus = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.FormStatus,
    );
    const expectedFormTopologyStatus = expectedFormStatusStatus(semanticUnit, report);
    if (formStatus && formStatus.status !== expectedFormTopologyStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Form Status facts require ${expectedFormTopologyStatus}, not ${formStatus.status}`,
      );
    }
    const optimisticState = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.OptimisticState,
    );
    const expectedOptimisticStatus = expectedOptimisticStateStatus(semanticUnit, report);
    if (optimisticState && optimisticState.status !== expectedOptimisticStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Optimistic state facts require ${expectedOptimisticStatus}, not ${optimisticState.status}`,
      );
    }
    const reactNodeFlow = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ReactNodeFlow,
    );
    const expectedReactNodeStatus = expectedReactNodeFlowStatus(semanticUnit, report);
    if (reactNodeFlow && reactNodeFlow.status !== expectedReactNodeStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `ReactNode slot facts require ${expectedReactNodeStatus}, not ${reactNodeFlow.status}`,
      );
    }
    const scheduledCallbackLifetime = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.ScheduledCallbackLifetime,
    );
    const expectedSchedulerStatus = expectedScheduledCallbackLifetimeStatus(semanticUnit, report);
    if (scheduledCallbackLifetime && scheduledCallbackLifetime.status !== expectedSchedulerStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Scheduler facts require ${expectedSchedulerStatus}, not ${scheduledCallbackLifetime.status}`,
      );
    }
    const effectCleanup = unitProof.obligations.find(
      (obligation) => obligation.claim === ReactProofClaim.EffectCleanup,
    );
    const expectedCleanupStatus = expectedEffectCleanupStatus(semanticUnit, report);
    if (effectCleanup && effectCleanup.status !== expectedCleanupStatus) {
      addFailure(
        failures,
        semanticUnit.id,
        `Effect resource facts require ${expectedCleanupStatus}, not ${effectCleanup.status}`,
      );
    }
  }
};

const addContextSource = (
  sourcesByUnit: Map<string, Map<string, Set<string>>>,
  unitId: string,
  contextId: string,
  sourceId: string,
): boolean => {
  let sourcesByContext = sourcesByUnit.get(unitId);
  if (!sourcesByContext) {
    sourcesByContext = new Map();
    sourcesByUnit.set(unitId, sourcesByContext);
  }
  let sources = sourcesByContext.get(contextId);
  if (!sources) {
    sources = new Set();
    sourcesByContext.set(contextId, sources);
  }
  const previousSize = sources.size;
  sources.add(sourceId);
  return sources.size !== previousSize;
};

const deriveContextSourcesByUnit = (
  report: ReactAppProofReport,
): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> => {
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const customHookEdges = report.graph.edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && unitIds.has(edge.targetId),
  );
  const providersById = new Map(
    report.graph.contextProviders.map((provider) => [provider.id, provider]),
  );
  const contexts = report.graph.contexts;
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const sourcesByUnit = new Map<string, Map<string, Set<string>>>();
  for (const unit of report.graph.units) {
    if (!unit.canBeRenderRoot) continue;
    for (const context of contexts) {
      addContextSource(sourcesByUnit, unit.id, context.id, REACT_CONTEXT_DEFAULT_SOURCE_ID);
    }
  }

  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of report.graph.renders) {
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
      for (const context of contexts) {
        const nearestProvider = render.activeContextProviderIds
          .toReversed()
          .map((providerId) => providersById.get(providerId))
          .find((provider) => provider?.contextId === context.id);
        if (nearestProvider) {
          didSourcesChange =
            addContextSource(sourcesByUnit, render.targetId, context.id, nearestProvider.id) ||
            didSourcesChange;
        } else {
          for (const sourceId of sourcesByUnit.get(render.ownerId)?.get(context.id) ?? []) {
            didSourcesChange =
              addContextSource(sourcesByUnit, render.targetId, context.id, sourceId) ||
              didSourcesChange;
          }
        }
        if (!render.contextTopologyComplete) {
          didSourcesChange =
            addContextSource(
              sourcesByUnit,
              render.targetId,
              context.id,
              REACT_CONTEXT_UNKNOWN_SOURCE_ID,
            ) || didSourcesChange;
        }
      }
    }
    for (const slotFlow of report.graph.slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (!sourceRender) continue;
      for (const context of contexts) {
        didSourcesChange =
          addContextSource(
            sourcesByUnit,
            sourceRender.targetId,
            context.id,
            REACT_CONTEXT_UNKNOWN_SOURCE_ID,
          ) || didSourcesChange;
      }
    }
    for (const hookEdge of customHookEdges) {
      for (const context of contexts) {
        for (const sourceId of sourcesByUnit.get(hookEdge.sourceId)?.get(context.id) ?? []) {
          didSourcesChange =
            addContextSource(sourcesByUnit, hookEdge.targetId, context.id, sourceId) ||
            didSourcesChange;
        }
      }
    }
  }
  return sourcesByUnit;
};

const deriveFormSourcesByUnit = (
  report: ReactAppProofReport,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const customHookEdges = report.graph.edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && unitIds.has(edge.targetId),
  );
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const sourcesByUnit = new Map<string, Set<string>>();
  const addSource = (unitId: string, sourceId: string): boolean => {
    let sources = sourcesByUnit.get(unitId);
    if (!sources) {
      sources = new Set();
      sourcesByUnit.set(unitId, sources);
    }
    const previousSize = sources.size;
    sources.add(sourceId);
    return sources.size !== previousSize;
  };
  for (const unit of report.graph.units) {
    if (unit.canBeRenderRoot) {
      addSource(unit.id, REACT_FORM_OUTSIDE_SOURCE_ID);
    }
  }

  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of report.graph.renders) {
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
      const nearestFormId = render.activeFormIds.at(-1);
      if (nearestFormId) {
        didSourcesChange = addSource(render.targetId, nearestFormId) || didSourcesChange;
      } else {
        for (const sourceId of sourcesByUnit.get(render.ownerId) ?? []) {
          if (!render.formTopologyComplete && sourceId === REACT_FORM_OUTSIDE_SOURCE_ID) {
            continue;
          }
          didSourcesChange = addSource(render.targetId, sourceId) || didSourcesChange;
        }
      }
      if (!render.formTopologyComplete) {
        didSourcesChange =
          addSource(render.targetId, REACT_FORM_UNKNOWN_SOURCE_ID) || didSourcesChange;
      }
    }
    for (const slotFlow of report.graph.slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (sourceRender) {
        didSourcesChange =
          addSource(sourceRender.targetId, REACT_FORM_UNKNOWN_SOURCE_ID) || didSourcesChange;
      }
    }
    for (const hookEdge of customHookEdges) {
      for (const sourceId of sourcesByUnit.get(hookEdge.sourceId) ?? []) {
        didSourcesChange = addSource(hookEdge.targetId, sourceId) || didSourcesChange;
      }
    }
  }
  return sourcesByUnit;
};

const deriveSuspenseSourcesByUnit = (
  report: ReactAppProofReport,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const sourcesByUnit = new Map<string, Set<string>>();
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const slotFlowsBySourceRenderId = new Map(
    report.graph.slotFlows.map((slotFlow) => [slotFlow.sourceRenderId, slotFlow]),
  );
  const boundaryIdsByRenderId = new Map<string, Set<string>>();
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const customHookEdges = report.graph.edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && unitIds.has(edge.targetId),
  );
  const addSource = (unitId: string, sourceId: string): boolean => {
    let sources = sourcesByUnit.get(unitId);
    if (!sources) {
      sources = new Set();
      sourcesByUnit.set(unitId, sources);
    }
    const previousSize = sources.size;
    sources.add(sourceId);
    return sources.size !== previousSize;
  };
  for (const boundary of report.graph.suspenseBoundaries) {
    for (const renderId of boundary.renderIds) {
      const boundaryIds = boundaryIdsByRenderId.get(renderId) ?? new Set<string>();
      boundaryIds.add(boundary.id);
      boundaryIdsByRenderId.set(renderId, boundaryIds);
    }
  }
  for (const unit of report.graph.units) {
    if (unit.canBeRenderRoot) addSource(unit.id, REACT_SUSPENSE_OUTSIDE_SOURCE_ID);
  }
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of report.graph.renders) {
      const boundaryIds = boundaryIdsByRenderId.get(render.id);
      if (
        render.kind === ReactSemanticRenderKind.SlotInput &&
        (!boundaryIds || boundaryIds.size === 0)
      ) {
        const slotFlow = slotFlowsBySourceRenderId.get(render.id);
        if (!slotFlow?.complete || slotFlow.renderIds.length > 0) continue;
      }
      if (boundaryIds && boundaryIds.size > 0) {
        for (const boundaryId of boundaryIds) {
          didSourcesChange = addSource(render.targetId, boundaryId) || didSourcesChange;
        }
      } else {
        for (const sourceId of sourcesByUnit.get(render.ownerId) ?? []) {
          didSourcesChange = addSource(render.targetId, sourceId) || didSourcesChange;
        }
      }
    }
    for (const slotFlow of report.graph.slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (sourceRender) {
        didSourcesChange =
          addSource(sourceRender.targetId, REACT_SUSPENSE_UNKNOWN_SOURCE_ID) || didSourcesChange;
      }
    }
    for (const hookEdge of customHookEdges) {
      for (const sourceId of sourcesByUnit.get(hookEdge.sourceId) ?? []) {
        didSourcesChange = addSource(hookEdge.targetId, sourceId) || didSourcesChange;
      }
    }
  }
  return sourcesByUnit;
};

const deriveErrorBoundarySourcesByUnit = (
  report: ReactAppProofReport,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const sourcesByUnit = new Map<string, Set<string>>();
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const boundaryIdsByRenderId = new Map<string, Set<string>>();
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const customHookEdges = report.graph.edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && unitIds.has(edge.targetId),
  );
  const addSource = (unitId: string, sourceId: string): boolean => {
    const sources = sourcesByUnit.get(unitId) ?? new Set<string>();
    const previousSize = sources.size;
    sources.add(sourceId);
    sourcesByUnit.set(unitId, sources);
    return sources.size !== previousSize;
  };
  for (const boundary of report.graph.errorBoundaries) {
    for (const renderId of boundary.renderIds) {
      const boundaryIds = boundaryIdsByRenderId.get(renderId) ?? new Set<string>();
      boundaryIds.add(boundary.id);
      boundaryIdsByRenderId.set(renderId, boundaryIds);
    }
  }
  for (const unit of report.graph.units) {
    if (unit.canBeRenderRoot) {
      addSource(unit.id, REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID);
    }
  }
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of report.graph.renders) {
      const boundaryIds = boundaryIdsByRenderId.get(render.id);
      if (
        render.kind === ReactSemanticRenderKind.SlotInput &&
        (!boundaryIds || boundaryIds.size === 0)
      ) {
        continue;
      }
      if (boundaryIds && boundaryIds.size > 0) {
        for (const boundaryId of boundaryIds) {
          didSourcesChange = addSource(render.targetId, boundaryId) || didSourcesChange;
        }
      } else {
        for (const sourceId of sourcesByUnit.get(render.ownerId) ?? []) {
          didSourcesChange = addSource(render.targetId, sourceId) || didSourcesChange;
        }
      }
    }
    for (const slotFlow of report.graph.slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (sourceRender && !boundaryIdsByRenderId.has(sourceRender.id)) {
        didSourcesChange =
          addSource(sourceRender.targetId, REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID) ||
          didSourcesChange;
      }
    }
    for (const hookEdge of customHookEdges) {
      for (const sourceId of sourcesByUnit.get(hookEdge.sourceId) ?? []) {
        didSourcesChange = addSource(hookEdge.targetId, sourceId) || didSourcesChange;
      }
    }
  }
  return sourcesByUnit;
};

const checkGraphReferences = (
  report: ReactAppProofReport,
  failures: ReactProofCertificateFailure[],
): void => {
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const unitsById = new Map(report.graph.units.map((unit) => [unit.id, unit]));
  const effectIds = new Set(report.graph.effects.map((effect) => effect.id));
  const effectsById = new Map(report.graph.effects.map((effect) => [effect.id, effect]));
  const callbackIds = new Set(report.graph.callbacks.map((callback) => callback.id));
  const callbacksById = new Map(report.graph.callbacks.map((callback) => [callback.id, callback]));
  const functionCallsById = new Map(
    report.graph.functionCalls.map((functionCall) => [functionCall.id, functionCall]),
  );
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const reachableFunctionsById = new Map(
    report.graph.reachableFunctions.map((reachableFunction) => [
      reachableFunction.id,
      reachableFunction,
    ]),
  );
  const contextIds = new Set(report.graph.contexts.map((context) => context.id));
  const providerIds = new Set(report.graph.contextProviders.map((provider) => provider.id));
  const providersById = new Map(
    report.graph.contextProviders.map((provider) => [provider.id, provider]),
  );
  const formsById = new Map(report.graph.forms.map((form) => [form.id, form]));
  const contextSourcesByUnit = deriveContextSourcesByUnit(report);
  const formSourcesByUnit = deriveFormSourcesByUnit(report);
  const suspenseSourcesByUnit = deriveSuspenseSourcesByUnit(report);
  const errorBoundarySourcesByUnit = deriveErrorBoundarySourcesByUnit(report);
  const hydrationSourcesByUnit = deriveHydrationSourcesByUnit(report);
  const hydrationRootsById = new Map(report.graph.hydrationRoots.map((root) => [root.id, root]));
  const hydrationHazardsById = new Map(
    report.graph.hydrationHazards.map((hazard) => [hazard.id, hazard]),
  );
  const errorBoundaryDefinitionsById = new Map(
    report.graph.errorBoundaryDefinitions.map((definition) => [definition.id, definition]),
  );
  const errorBoundariesById = new Map(
    report.graph.errorBoundaries.map((boundary) => [boundary.id, boundary]),
  );
  const errorBoundaryInstanceIdsByDefinitionId = new Map(
    report.graph.errorBoundaryDefinitions.map((definition) => [
      definition.id,
      new Set(definition.instanceIds),
    ]),
  );
  const suspenseBoundariesById = new Map(
    report.graph.suspenseBoundaries.map((boundary) => [boundary.id, boundary]),
  );
  const lazyComponentsById = new Map(
    report.graph.lazyComponents.map((component) => [component.id, component]),
  );
  const lazyRendersById = new Map(report.graph.lazyRenders.map((render) => [render.id, render]));
  const lazyRenderIdsByComponentId = new Map<string, string[]>();
  for (const render of report.graph.lazyRenders) {
    const renderIds = lazyRenderIdsByComponentId.get(render.lazyComponentId) ?? [];
    renderIds.push(render.id);
    lazyRenderIdsByComponentId.set(render.lazyComponentId, renderIds);
  }
  const imperativeHandlesById = new Map(
    report.graph.imperativeHandles.map((handle) => [handle.id, handle]),
  );
  const imperativeMethodsById = new Map(
    report.graph.imperativeHandleMethods.map((method) => [method.id, method]),
  );
  const imperativeBindingsById = new Map(
    report.graph.imperativeHandleBindings.map((binding) => [binding.id, binding]),
  );
  const imperativeInvocationsById = new Map(
    report.graph.imperativeHandleInvocations.map((invocation) => [invocation.id, invocation]),
  );
  const imperativeMethodIdsByHandleId = new Map(
    report.graph.imperativeHandles.map((handle) => [handle.id, new Set(handle.methodIds)]),
  );
  const imperativeBindingIdsByHandleId = new Map(
    report.graph.imperativeHandles.map((handle) => [handle.id, new Set(handle.bindingIds)]),
  );
  const imperativeInvocationIdsByBindingId = new Map(
    report.graph.imperativeHandleBindings.map((binding) => [
      binding.id,
      new Set(binding.invocationIds),
    ]),
  );
  for (const definition of report.graph.errorBoundaryDefinitions) {
    const owner = unitsById.get(definition.ownerId);
    if (!owner || owner.kind !== ReactUnitKind.ClassComponent) {
      addFailure(
        failures,
        definition.id,
        "An Error Boundary definition has no class component owner",
      );
    }
    if (
      !ERROR_BOUNDARY_PROTOCOL_STATUSES.has(definition.derivedStateStatus) ||
      !ERROR_BOUNDARY_PROTOCOL_STATUSES.has(definition.fallbackRenderStatus)
    ) {
      addFailure(failures, definition.id, "An Error Boundary has an invalid protocol status");
    }
    if (new Set(definition.instanceIds).size !== definition.instanceIds.length) {
      addFailure(failures, definition.id, "An Error Boundary definition repeats an instance");
    }
    if (
      definition.instanceIds.some(
        (instanceId) => errorBoundariesById.get(instanceId)?.definitionId !== definition.id,
      )
    ) {
      addFailure(
        failures,
        definition.id,
        "An Error Boundary definition has an invalid instance link",
      );
    }
    const expectedSourceComplete =
      definition.derivedStateStatus !== ReactErrorBoundaryProtocolStatus.Unknown &&
      definition.fallbackRenderStatus !== ReactErrorBoundaryProtocolStatus.Unknown;
    const expectedComplete =
      expectedSourceComplete &&
      definition.derivedStateStatus === ReactErrorBoundaryProtocolStatus.Valid &&
      definition.fallbackRenderStatus === ReactErrorBoundaryProtocolStatus.Valid;
    if (definition.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, definition.id, "An Error Boundary source certificate is inconsistent");
    }
    if (definition.complete !== expectedComplete) {
      addFailure(failures, definition.id, "An Error Boundary completeness flag is inconsistent");
    }
    if (
      definition.derivedStateStatus === ReactErrorBoundaryProtocolStatus.Valid &&
      (!definition.derivedStateLocation || !definition.fallbackStateKey)
    ) {
      addFailure(
        failures,
        definition.id,
        "A valid Error Boundary has no derived-state method or fallback key",
      );
    }
  }
  for (const boundary of report.graph.errorBoundaries) {
    const definition = errorBoundaryDefinitionsById.get(boundary.definitionId);
    if (!unitIds.has(boundary.ownerId) || !definition) {
      addFailure(
        failures,
        boundary.id,
        "An Error Boundary instance has an unknown owner or definition",
      );
    }
    if (!errorBoundaryInstanceIdsByDefinitionId.get(boundary.definitionId)?.has(boundary.id)) {
      addFailure(
        failures,
        boundary.id,
        "An Error Boundary instance is not linked from its definition",
      );
    }
    if (new Set(boundary.renderIds).size !== boundary.renderIds.length) {
      addFailure(failures, boundary.id, "An Error Boundary repeats a protected render");
    }
    if (boundary.renderIds.some((renderId) => !rendersById.has(renderId))) {
      addFailure(failures, boundary.id, "An Error Boundary references an unknown render");
    }
  }
  for (const renderFailure of report.graph.renderFailures) {
    if (!unitIds.has(renderFailure.ownerId)) {
      addFailure(failures, renderFailure.id, "A render failure has an unknown owner unit");
    }
    if (!RENDER_FAILURE_KINDS.has(renderFailure.kind)) {
      addFailure(failures, renderFailure.id, "A render failure has an invalid kind");
    }
    if (!ERROR_BOUNDARY_COVERAGE_STATUSES.has(renderFailure.coverageStatus)) {
      addFailure(failures, renderFailure.id, "A render failure has an invalid coverage status");
    }
    if (new Set(renderFailure.sourceBoundaryIds).size !== renderFailure.sourceBoundaryIds.length) {
      addFailure(failures, renderFailure.id, "A render failure repeats a source boundary");
    }
    const expectedSources = errorBoundarySourcesByUnit.get(renderFailure.ownerId) ?? new Set();
    if (expectedSources.size === 0) {
      addFailure(failures, renderFailure.id, "An unreachable render failure has a graph fact");
    }
    const expectedBoundaryIds = [...expectedSources].filter(
      (sourceId) =>
        sourceId !== REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID &&
        sourceId !== REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID,
    );
    if (
      expectedBoundaryIds.length !== renderFailure.sourceBoundaryIds.length ||
      expectedBoundaryIds.some(
        (boundaryId) => !renderFailure.sourceBoundaryIds.includes(boundaryId),
      )
    ) {
      addFailure(failures, renderFailure.id, "A render failure has inconsistent boundary sources");
    }
    const sourceDefinitions = expectedBoundaryIds.flatMap((boundaryId) => {
      const boundary = errorBoundariesById.get(boundaryId);
      const definition = boundary ? errorBoundaryDefinitionsById.get(boundary.definitionId) : null;
      return definition ? [definition] : [];
    });
    const expectedOutsideBoundary = expectedSources.has(REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID);
    const expectedTopologyComplete =
      !expectedSources.has(REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID) &&
      sourceDefinitions.length === expectedBoundaryIds.length &&
      sourceDefinitions.every((definition) => definition.sourceComplete);
    const hasValidBoundary = sourceDefinitions.some((definition) => definition.complete);
    let expectedCoverageStatus = ReactErrorBoundaryCoverageStatus.Unknown;
    if (expectedOutsideBoundary || (expectedTopologyComplete && !hasValidBoundary)) {
      expectedCoverageStatus = ReactErrorBoundaryCoverageStatus.OutsideBoundary;
    } else if (expectedTopologyComplete && hasValidBoundary) {
      expectedCoverageStatus = ReactErrorBoundaryCoverageStatus.Covered;
    }
    if (renderFailure.outsideBoundary !== expectedOutsideBoundary) {
      addFailure(failures, renderFailure.id, "A render failure outside flag is inconsistent");
    }
    if (
      renderFailure.topologyComplete !== expectedTopologyComplete ||
      renderFailure.sourceComplete !== expectedTopologyComplete
    ) {
      addFailure(failures, renderFailure.id, "A render failure source certificate is inconsistent");
    }
    if (renderFailure.coverageStatus !== expectedCoverageStatus) {
      addFailure(failures, renderFailure.id, "A render failure coverage status is inconsistent");
    }
    if (
      renderFailure.complete !==
      (expectedCoverageStatus === ReactErrorBoundaryCoverageStatus.Covered)
    ) {
      addFailure(failures, renderFailure.id, "A render failure completeness flag is inconsistent");
    }
  }
  for (const resource of report.graph.useResources) {
    if (!unitIds.has(resource.ownerId)) {
      addFailure(failures, resource.id, "A use resource has an unknown owner unit");
    }
    if (!USE_RESOURCE_KINDS.has(resource.kind)) {
      addFailure(failures, resource.id, "A use resource has an invalid type kind");
    }
    if (!USE_RESOURCE_IDENTITY_STATUSES.has(resource.identityStatus)) {
      addFailure(failures, resource.id, "A use resource has an invalid identity status");
    }
    if (!SUSPENSE_COVERAGE_STATUSES.has(resource.suspenseCoverageStatus)) {
      addFailure(failures, resource.id, "A use resource has an invalid Suspense status");
    }
    if (!ERROR_BOUNDARY_COVERAGE_STATUSES.has(resource.errorCoverageStatus)) {
      addFailure(failures, resource.id, "A use resource has an invalid Error Boundary status");
    }
    if (
      new Set(resource.sourceSuspenseBoundaryIds).size !==
        resource.sourceSuspenseBoundaryIds.length ||
      resource.sourceSuspenseBoundaryIds.some(
        (boundaryId) => !suspenseBoundariesById.has(boundaryId),
      )
    ) {
      addFailure(failures, resource.id, "A use resource has invalid Suspense sources");
    }
    if (
      new Set(resource.sourceErrorBoundaryIds).size !== resource.sourceErrorBoundaryIds.length ||
      resource.sourceErrorBoundaryIds.some((boundaryId) => !errorBoundariesById.has(boundaryId))
    ) {
      addFailure(failures, resource.id, "A use resource has invalid Error Boundary sources");
    }
    const expectedSuspenseSources =
      suspenseSourcesByUnit.get(resource.ownerId) ?? new Set<string>();
    const expectedSuspenseBoundaryIds = [...expectedSuspenseSources].filter(
      (sourceId) =>
        sourceId !== REACT_SUSPENSE_OUTSIDE_SOURCE_ID &&
        sourceId !== REACT_SUSPENSE_UNKNOWN_SOURCE_ID,
    );
    if (
      expectedSuspenseBoundaryIds.length !== resource.sourceSuspenseBoundaryIds.length ||
      expectedSuspenseBoundaryIds.some(
        (boundaryId) => !resource.sourceSuspenseBoundaryIds.includes(boundaryId),
      )
    ) {
      addFailure(failures, resource.id, "A use resource has inconsistent Suspense sources");
    }
    const expectedOutsideSuspenseBoundary = expectedSuspenseSources.has(
      REACT_SUSPENSE_OUTSIDE_SOURCE_ID,
    );
    const expectedSuspenseTopologyComplete =
      expectedSuspenseSources.size > 0 &&
      !expectedSuspenseSources.has(REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    let expectedSuspenseCoverageStatus = ReactSuspenseCoverageStatus.Unknown;
    if (expectedOutsideSuspenseBoundary) {
      expectedSuspenseCoverageStatus = ReactSuspenseCoverageStatus.OutsideBoundary;
    } else if (expectedSuspenseTopologyComplete && expectedSuspenseBoundaryIds.length > 0) {
      expectedSuspenseCoverageStatus = ReactSuspenseCoverageStatus.Covered;
    }

    const expectedErrorSources =
      errorBoundarySourcesByUnit.get(resource.ownerId) ?? new Set<string>();
    const expectedErrorBoundaryIds = [...expectedErrorSources].filter(
      (sourceId) =>
        sourceId !== REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID &&
        sourceId !== REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID,
    );
    if (
      expectedErrorBoundaryIds.length !== resource.sourceErrorBoundaryIds.length ||
      expectedErrorBoundaryIds.some(
        (boundaryId) => !resource.sourceErrorBoundaryIds.includes(boundaryId),
      )
    ) {
      addFailure(failures, resource.id, "A use resource has inconsistent Error Boundary sources");
    }
    const sourceDefinitions = expectedErrorBoundaryIds.flatMap((boundaryId) => {
      const boundary = errorBoundariesById.get(boundaryId);
      const definition = boundary ? errorBoundaryDefinitionsById.get(boundary.definitionId) : null;
      return definition ? [definition] : [];
    });
    const expectedOutsideErrorBoundary = expectedErrorSources.has(
      REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID,
    );
    const expectedErrorTopologyComplete =
      expectedErrorSources.size > 0 &&
      !expectedErrorSources.has(REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID) &&
      sourceDefinitions.length === expectedErrorBoundaryIds.length &&
      sourceDefinitions.every((definition) => definition.sourceComplete);
    const hasValidErrorBoundary =
      sourceDefinitions.length > 0 && sourceDefinitions.every((definition) => definition.complete);
    let expectedErrorCoverageStatus = ReactErrorBoundaryCoverageStatus.Unknown;
    if (expectedOutsideErrorBoundary || (expectedErrorTopologyComplete && !hasValidErrorBoundary)) {
      expectedErrorCoverageStatus = ReactErrorBoundaryCoverageStatus.OutsideBoundary;
    } else if (expectedErrorTopologyComplete && hasValidErrorBoundary) {
      expectedErrorCoverageStatus = ReactErrorBoundaryCoverageStatus.Covered;
    }
    const expectedSourceComplete =
      resource.kind !== ReactUseResourceKind.Unknown &&
      resource.identityStatus !== ReactUseResourceIdentityStatus.Unknown &&
      expectedSuspenseTopologyComplete &&
      expectedErrorTopologyComplete;
    const expectedComplete =
      expectedSourceComplete &&
      resource.kind === ReactUseResourceKind.Thenable &&
      resource.identityStatus === ReactUseResourceIdentityStatus.Stable &&
      expectedSuspenseCoverageStatus === ReactSuspenseCoverageStatus.Covered &&
      expectedErrorCoverageStatus === ReactErrorBoundaryCoverageStatus.Covered;
    if (
      resource.outsideSuspenseBoundary !== expectedOutsideSuspenseBoundary ||
      resource.suspenseTopologyComplete !== expectedSuspenseTopologyComplete ||
      resource.suspenseCoverageStatus !== expectedSuspenseCoverageStatus
    ) {
      addFailure(failures, resource.id, "A use resource Suspense certificate is inconsistent");
    }
    if (
      resource.outsideErrorBoundary !== expectedOutsideErrorBoundary ||
      resource.errorTopologyComplete !== expectedErrorTopologyComplete ||
      resource.errorCoverageStatus !== expectedErrorCoverageStatus
    ) {
      addFailure(
        failures,
        resource.id,
        "A use resource Error Boundary certificate is inconsistent",
      );
    }
    if (resource.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, resource.id, "A use resource source certificate is inconsistent");
    }
    if (resource.complete !== expectedComplete) {
      addFailure(failures, resource.id, "A use resource completeness flag is inconsistent");
    }
  }
  for (const boundary of report.graph.suspenseBoundaries) {
    if (!unitIds.has(boundary.ownerId)) {
      addFailure(failures, boundary.id, "A Suspense boundary has an unknown owner unit");
    }
    if (new Set(boundary.renderIds).size !== boundary.renderIds.length) {
      addFailure(failures, boundary.id, "A Suspense boundary repeats a covered render");
    }
    if (boundary.renderIds.some((renderId) => !rendersById.has(renderId))) {
      addFailure(failures, boundary.id, "A Suspense boundary references an unknown render");
    }
  }
  for (const component of report.graph.lazyComponents) {
    if (component.declarationOwnerId && !unitIds.has(component.declarationOwnerId)) {
      addFailure(failures, component.id, "A lazy component has an unknown declaration owner");
    }
    if (!LAZY_DECLARATION_STATUSES.has(component.declarationStatus)) {
      addFailure(failures, component.id, "A lazy component has an invalid declaration status");
    }
    if (!LAZY_LOADER_STATUSES.has(component.loaderStatus)) {
      addFailure(failures, component.id, "A lazy component has an invalid loader status");
    }
    if (
      component.declarationStatus === ReactLazyDeclarationStatus.ModuleStable &&
      component.declarationOwnerId
    ) {
      addFailure(failures, component.id, "A module-stable lazy component has a render owner");
    }
    if (new Set(component.renderIds).size !== component.renderIds.length) {
      addFailure(failures, component.id, "A lazy component repeats a render");
    }
    const componentRenders = component.renderIds.flatMap((renderId) => {
      const render = lazyRendersById.get(renderId);
      if (!render || render.lazyComponentId !== component.id) {
        addFailure(failures, component.id, "A lazy component has an invalid render link");
        return [];
      }
      return [render];
    });
    const reciprocalRenderIds = lazyRenderIdsByComponentId.get(component.id) ?? [];
    const componentRenderIds = new Set(component.renderIds);
    if (
      reciprocalRenderIds.length !== component.renderIds.length ||
      reciprocalRenderIds.some((renderId) => !componentRenderIds.has(renderId))
    ) {
      addFailure(failures, component.id, "A lazy component render set is not reciprocal");
    }
    const expectedSourceComplete =
      component.identityResolved && component.loaderStatus !== ReactLazyLoaderStatus.Opaque;
    if (component.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, component.id, "A lazy component source flag is inconsistent");
    }
    const expectedComplete =
      component.identityResolved &&
      !component.canBeRenderRoot &&
      component.declarationStatus === ReactLazyDeclarationStatus.ModuleStable &&
      component.loaderStatus === ReactLazyLoaderStatus.Valid &&
      componentRenders.length === component.renderIds.length &&
      componentRenders.every((render) => render.complete);
    if (component.complete !== expectedComplete) {
      addFailure(failures, component.id, "A lazy component completeness flag is inconsistent");
    }
  }
  for (const render of report.graph.lazyRenders) {
    if (!unitIds.has(render.ownerId)) {
      addFailure(failures, render.id, "A lazy render has an unknown owner unit");
    }
    if (!lazyComponentsById.has(render.lazyComponentId)) {
      addFailure(failures, render.id, "A lazy render has an unknown component");
    }
    if (!SUSPENSE_COVERAGE_STATUSES.has(render.coverageStatus)) {
      addFailure(failures, render.id, "A lazy render has an invalid coverage status");
    }
    if (
      new Set(render.topologyBoundaryIds).size !== render.topologyBoundaryIds.length ||
      render.topologyBoundaryIds.some((boundaryId) => !suspenseBoundariesById.has(boundaryId))
    ) {
      addFailure(failures, render.id, "A lazy render has invalid direct Suspense boundaries");
    }
    if (
      new Set(render.sourceBoundaryIds).size !== render.sourceBoundaryIds.length ||
      render.sourceBoundaryIds.some((boundaryId) => !suspenseBoundariesById.has(boundaryId))
    ) {
      addFailure(failures, render.id, "A lazy render has invalid source Suspense boundaries");
    }
    const expectedSources = new Set(render.topologyBoundaryIds);
    if (render.inheritsOwnerBoundary) {
      for (const sourceId of suspenseSourcesByUnit.get(render.ownerId) ?? []) {
        expectedSources.add(sourceId);
      }
    }
    if (!render.topologyComplete) expectedSources.add(REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    const expectedBoundaryIds = [...expectedSources].filter(
      (sourceId) =>
        sourceId !== REACT_SUSPENSE_OUTSIDE_SOURCE_ID &&
        sourceId !== REACT_SUSPENSE_UNKNOWN_SOURCE_ID,
    );
    if (
      expectedBoundaryIds.length !== render.sourceBoundaryIds.length ||
      expectedBoundaryIds.some((boundaryId) => !render.sourceBoundaryIds.includes(boundaryId))
    ) {
      addFailure(failures, render.id, "A lazy render has an inconsistent boundary source set");
    }
    const expectedOutsideBoundary = expectedSources.has(REACT_SUSPENSE_OUTSIDE_SOURCE_ID);
    const expectedSourceComplete =
      expectedSources.size > 0 && !expectedSources.has(REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    let expectedCoverageStatus = ReactSuspenseCoverageStatus.Unknown;
    if (expectedOutsideBoundary) {
      expectedCoverageStatus = ReactSuspenseCoverageStatus.OutsideBoundary;
    } else if (expectedSourceComplete && expectedBoundaryIds.length > 0) {
      expectedCoverageStatus = ReactSuspenseCoverageStatus.Covered;
    }
    if (render.outsideBoundary !== expectedOutsideBoundary) {
      addFailure(failures, render.id, "A lazy render outside-boundary flag is inconsistent");
    }
    if (render.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, render.id, "A lazy render source flag is inconsistent");
    }
    if (render.coverageStatus !== expectedCoverageStatus) {
      addFailure(failures, render.id, "A lazy render coverage status is inconsistent");
    }
    if (render.complete !== (expectedCoverageStatus === ReactSuspenseCoverageStatus.Covered)) {
      addFailure(failures, render.id, "A lazy render completeness flag is inconsistent");
    }
  }
  for (const method of report.graph.imperativeHandleMethods) {
    const handle = imperativeHandlesById.get(method.handleId);
    if (
      !handle ||
      handle.ownerId !== method.ownerId ||
      !imperativeMethodIdsByHandleId.get(handle.id)?.has(method.id) ||
      !method.name
    ) {
      addFailure(
        failures,
        method.id,
        "An imperative handle method has an invalid owner or reciprocal handle link",
      );
    }
  }
  for (const binding of report.graph.imperativeHandleBindings) {
    const handle = imperativeHandlesById.get(binding.handleId);
    const render = rendersById.get(binding.renderId);
    const bindingInvocations = binding.invocationIds.flatMap((invocationId) => {
      const invocation = imperativeInvocationsById.get(invocationId);
      if (
        !invocation ||
        invocation.bindingId !== binding.id ||
        invocation.handleId !== binding.handleId
      ) {
        addFailure(
          failures,
          binding.id,
          "An imperative handle binding has an invalid invocation link",
        );
        return [];
      }
      return [invocation];
    });
    if (
      !handle ||
      !imperativeBindingIdsByHandleId.get(handle.id)?.has(binding.id) ||
      !render ||
      render.kind !== ReactSemanticRenderKind.Direct ||
      render.ownerId !== binding.ownerId ||
      render.targetId !== handle.ownerId ||
      !binding.refName
    ) {
      addFailure(
        failures,
        binding.id,
        "An imperative handle binding has an invalid owner, render, or ref identity",
      );
    }
    if (new Set(binding.invocationIds).size !== binding.invocationIds.length) {
      addFailure(failures, binding.id, "An imperative handle binding repeats an invocation");
    }
    const expectedSourceComplete =
      binding.referenceComplete &&
      Boolean(render) &&
      bindingInvocations.length === binding.invocationIds.length &&
      bindingInvocations.every((invocation) => invocation.sourceComplete);
    if (binding.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, binding.id, "An imperative handle binding source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete && bindingInvocations.every((invocation) => invocation.complete);
    if (binding.complete !== expectedComplete) {
      addFailure(
        failures,
        binding.id,
        "An imperative handle binding completeness flag is inconsistent",
      );
    }
  }
  for (const invocation of report.graph.imperativeHandleInvocations) {
    const handle = imperativeHandlesById.get(invocation.handleId);
    const method = imperativeMethodsById.get(invocation.methodId);
    const binding = imperativeBindingsById.get(invocation.bindingId);
    const callerCallbacks = invocation.callerCallbackIds.flatMap((callbackId) => {
      const callback = callbacksById.get(callbackId);
      if (
        !callback ||
        callback.ownerId !== invocation.ownerId ||
        callback.phase === ReactExecutionPhase.Render
      ) {
        addFailure(
          failures,
          invocation.id,
          "An imperative handle invocation has an invalid caller callback",
        );
        return [];
      }
      return [callback];
    });
    const methodCallbacks = invocation.methodCallbackIds.flatMap((callbackId) => {
      const callback = callbacksById.get(callbackId);
      if (
        !callback ||
        callback.ownerId !== handle?.ownerId ||
        callback.kind !== ReactSemanticCallbackKind.ImperativeHandleMethod ||
        !method ||
        !areProofLocationsEqual(callback.location, method.location)
      ) {
        addFailure(
          failures,
          invocation.id,
          "An imperative handle invocation has an invalid method callback",
        );
        return [];
      }
      return [callback];
    });
    if (
      !handle ||
      !method ||
      method.handleId !== handle.id ||
      !binding ||
      binding.handleId !== handle.id ||
      binding.ownerId !== invocation.ownerId ||
      !imperativeInvocationIdsByBindingId.get(binding.id)?.has(invocation.id)
    ) {
      addFailure(
        failures,
        invocation.id,
        "An imperative handle invocation has an invalid handle, method, or binding",
      );
    }
    if (
      new Set(invocation.callerCallbackIds).size !== invocation.callerCallbackIds.length ||
      new Set(invocation.methodCallbackIds).size !== invocation.methodCallbackIds.length
    ) {
      addFailure(failures, invocation.id, "An imperative handle invocation repeats a callback");
    }
    const callerPhases = new Set(callerCallbacks.map((callback) => callback.phase));
    const methodPhases = new Set(methodCallbacks.map((callback) => callback.phase));
    const phasesMatch =
      callerPhases.size === methodPhases.size &&
      [...callerPhases].every((phase) => methodPhases.has(phase));
    const expectedSourceComplete =
      Boolean(handle && method && binding) &&
      Boolean(binding?.referenceComplete) &&
      callerCallbacks.length === invocation.callerCallbackIds.length &&
      callerCallbacks.length > 0;
    if (invocation.sourceComplete !== expectedSourceComplete) {
      addFailure(
        failures,
        invocation.id,
        "An imperative handle invocation source flag is inconsistent",
      );
    }
    const expectedComplete =
      expectedSourceComplete &&
      methodCallbacks.length === invocation.methodCallbackIds.length &&
      methodCallbacks.length > 0 &&
      phasesMatch;
    if (invocation.complete !== expectedComplete) {
      addFailure(
        failures,
        invocation.id,
        "An imperative handle invocation completeness flag is inconsistent",
      );
    }
  }
  for (const handle of report.graph.imperativeHandles) {
    const owner = unitsById.get(handle.ownerId);
    const factoryCallback = handle.factoryCallbackId
      ? callbacksById.get(handle.factoryCallbackId)
      : null;
    const methods = handle.methodIds.flatMap((methodId) => {
      const method = imperativeMethodsById.get(methodId);
      return method?.handleId === handle.id ? [method] : [];
    });
    const bindings = handle.bindingIds.flatMap((bindingId) => {
      const binding = imperativeBindingsById.get(bindingId);
      return binding?.handleId === handle.id ? [binding] : [];
    });
    if (
      owner?.kind !== ReactUnitKind.Component ||
      (handle.refKind !== null && !IMPERATIVE_HANDLE_REF_KINDS.has(handle.refKind)) ||
      !IMPERATIVE_HANDLE_STATUSES.has(handle.status) ||
      !OBLIGATION_STATUSES.has(handle.factoryPurity)
    ) {
      addFailure(failures, handle.id, "An imperative handle has an invalid owner or status");
    }
    if (
      factoryCallback?.ownerId !== handle.ownerId ||
      factoryCallback.kind !== ReactSemanticCallbackKind.ImperativeHandleFactory ||
      factoryCallback.phase !== ReactExecutionPhase.ImperativeHandle
    ) {
      addFailure(failures, handle.id, "An imperative handle has an invalid factory callback");
    }
    if (
      new Set(handle.methodIds).size !== handle.methodIds.length ||
      methods.length !== handle.methodIds.length
    ) {
      addFailure(failures, handle.id, "An imperative handle has invalid method links");
    }
    if (
      new Set(handle.bindingIds).size !== handle.bindingIds.length ||
      bindings.length !== handle.bindingIds.length
    ) {
      addFailure(failures, handle.id, "An imperative handle has invalid binding links");
    }
    const hasMissingDependency =
      handle.dependencyMode === ReactEffectDependencyMode.Inline &&
      handle.captures.some(
        (capture) =>
          !handle.dependencies.some(
            (dependency) =>
              dependency === capture ||
              capture.startsWith(`${dependency}.`) ||
              dependency.startsWith(`${capture}.`),
          ),
      );
    if (
      (handle.status === ReactImperativeHandleStatus.ImpureFactory &&
        handle.factoryPurity !== ReactObligationStatus.Violated) ||
      (handle.factoryPurity === ReactObligationStatus.Violated &&
        handle.status !== ReactImperativeHandleStatus.ImpureFactory)
    ) {
      addFailure(failures, handle.id, "An imperative handle factory purity is inconsistent");
    }
    if (
      (handle.status === ReactImperativeHandleStatus.MissingDependency && !hasMissingDependency) ||
      (handle.status !== ReactImperativeHandleStatus.ImpureFactory && hasMissingDependency) !==
        (handle.status === ReactImperativeHandleStatus.MissingDependency)
    ) {
      addFailure(failures, handle.id, "An imperative handle dependency status is inconsistent");
    }
    if (
      handle.status === ReactImperativeHandleStatus.Resolved &&
      handle.dependencyMode === ReactEffectDependencyMode.Opaque
    ) {
      addFailure(failures, handle.id, "A resolved imperative handle has an opaque dependency list");
    }
    const expectedFactoryComplete =
      Boolean(factoryCallback) &&
      handle.dependencyMode !== ReactEffectDependencyMode.Opaque &&
      handle.factoryPurity !== ReactObligationStatus.Unknown;
    if (handle.factoryComplete !== expectedFactoryComplete) {
      addFailure(failures, handle.id, "An imperative handle factory flag is inconsistent");
    }
    const expectedSourceComplete =
      handle.factoryComplete &&
      handle.shapeComplete &&
      handle.targetComplete &&
      handle.bindingComplete &&
      !owner?.canBeRenderRoot;
    if (handle.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, handle.id, "An imperative handle source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete && handle.status === ReactImperativeHandleStatus.Resolved;
    if (handle.complete !== expectedComplete) {
      addFailure(failures, handle.id, "An imperative handle completeness flag is inconsistent");
    }
  }
  for (const unit of report.graph.units) {
    if (
      unit.canBeRenderRoot &&
      unit.kind !== ReactUnitKind.Component &&
      unit.kind !== ReactUnitKind.ClassComponent
    ) {
      addFailure(failures, unit.id, "A non-component unit is marked as a render root");
    }
    if (
      unit.kind === ReactUnitKind.ClassComponent &&
      unit.classComponentBase !== ReactClassComponentBase.Component &&
      unit.classComponentBase !== ReactClassComponentBase.PureComponent
    ) {
      addFailure(failures, unit.id, "A class component has no supported React base");
    }
    if (unit.kind !== ReactUnitKind.ClassComponent && unit.classComponentBase !== null) {
      addFailure(failures, unit.id, "A non-class unit declares a React class base");
    }
  }

  for (const root of report.graph.hydrationRoots) {
    if (!HYDRATION_ROOT_KINDS.has(root.kind)) {
      addFailure(failures, root.id, "A hydration root has an unknown kind");
    }
    if (!HYDRATION_PREFIX_STATUSES.has(root.prefixStatus)) {
      addFailure(failures, root.id, "A hydration root has an unknown prefix status");
    }
    if (!HYDRATION_ROOT_EXECUTION_STATUSES.has(root.executionStatus)) {
      addFailure(failures, root.id, "A hydration root has an unknown execution status");
    }
    let expectedKind: ReactHydrationRootKind | null = null;
    if (root.apiName === "hydrateRoot") {
      expectedKind = ReactHydrationRootKind.Client;
    } else if (REACT_HYDRATABLE_SERVER_API_NAMES.has(root.apiName)) {
      expectedKind = ReactHydrationRootKind.ServerInteractive;
    } else if (REACT_STATIC_SERVER_API_NAMES.has(root.apiName)) {
      expectedKind = ReactHydrationRootKind.ServerStatic;
    }
    if (root.kind !== expectedKind) {
      addFailure(failures, root.id, "A hydration root API and kind are inconsistent");
    }
    if (root.targetId !== null && !unitIds.has(root.targetId)) {
      addFailure(failures, root.id, "A hydration root has an unknown target unit");
    }
    if (
      (root.prefixStatus === ReactHydrationPrefixStatus.Known && root.identifierPrefix === null) ||
      (root.prefixStatus === ReactHydrationPrefixStatus.Unknown && root.identifierPrefix !== null)
    ) {
      addFailure(failures, root.id, "A hydration root prefix certificate is inconsistent");
    }
    const expectedSourceComplete =
      root.targetId !== null &&
      root.prefixStatus === ReactHydrationPrefixStatus.Known &&
      root.executionStatus === ReactHydrationRootExecutionStatus.Module;
    if (
      root.sourceComplete !== expectedSourceComplete ||
      root.complete !== expectedSourceComplete
    ) {
      addFailure(failures, root.id, "A hydration root completeness flag is inconsistent");
    }
  }
  for (const hazard of report.graph.hydrationHazards) {
    if (!unitIds.has(hazard.ownerId)) {
      addFailure(failures, hazard.id, "A hydration hazard has an unknown owner unit");
    }
    if (!HYDRATION_HAZARD_KINDS.has(hazard.kind)) {
      addFailure(failures, hazard.id, "A hydration hazard has an unknown kind");
    }
  }
  const hydrationFactsByOwnerId = new Map<string, typeof report.graph.hydrations>();
  for (const hydration of report.graph.hydrations) {
    const owner = unitsById.get(hydration.ownerId);
    if (!owner) {
      addFailure(failures, hydration.id, "A hydration certificate has an unknown owner unit");
      continue;
    }
    if (!HYDRATION_STATUSES.has(hydration.status)) {
      addFailure(failures, hydration.id, "A hydration certificate has an unknown status");
    }
    const rootCollections = [
      {
        ids: hydration.clientRootIds,
        kind: ReactHydrationRootKind.Client,
      },
      {
        ids: hydration.interactiveServerRootIds,
        kind: ReactHydrationRootKind.ServerInteractive,
      },
      {
        ids: hydration.staticServerRootIds,
        kind: ReactHydrationRootKind.ServerStatic,
      },
    ];
    for (const rootCollection of rootCollections) {
      if (new Set(rootCollection.ids).size !== rootCollection.ids.length) {
        addFailure(failures, hydration.id, "A hydration certificate repeats a root");
      }
      for (const rootId of rootCollection.ids) {
        if (hydrationRootsById.get(rootId)?.kind !== rootCollection.kind) {
          addFailure(failures, hydration.id, "A hydration certificate has an invalid root kind");
        }
      }
    }
    if (new Set(hydration.hazardIds).size !== hydration.hazardIds.length) {
      addFailure(failures, hydration.id, "A hydration certificate repeats a hazard");
    }
    if (
      hydration.hazardIds.some(
        (hazardId) => hydrationHazardsById.get(hazardId)?.ownerId !== hydration.ownerId,
      )
    ) {
      addFailure(failures, hydration.id, "A hydration certificate has an invalid hazard");
    }
    const expected = expectedHydrationProtocol(owner, report, hydrationSourcesByUnit);
    const actualCollections = [
      [hydration.clientRootIds, expected.clientRootIds],
      [hydration.interactiveServerRootIds, expected.interactiveServerRootIds],
      [hydration.staticServerRootIds, expected.staticServerRootIds],
      [hydration.hazardIds, expected.hazardIds],
    ];
    if (
      actualCollections.some(
        ([actual, expectedIds]) =>
          actual.length !== expectedIds.length ||
          expectedIds.some((expectedId) => !actual.includes(expectedId)),
      )
    ) {
      addFailure(failures, hydration.id, "A hydration certificate has inconsistent sources");
    }
    if (
      hydration.status !== expected.status ||
      hydration.sourceComplete !== expected.sourceComplete ||
      hydration.complete !== expected.complete
    ) {
      addFailure(failures, hydration.id, "A hydration certificate has inconsistent verdict facts");
    }
    const ownerHydrations = hydrationFactsByOwnerId.get(hydration.ownerId) ?? [];
    hydrationFactsByOwnerId.set(hydration.ownerId, [...ownerHydrations, hydration]);
  }
  for (const unit of report.graph.units) {
    if (hydrationFactsByOwnerId.get(unit.id)?.length !== 1) {
      addFailure(failures, unit.id, "A semantic unit has no unique hydration certificate");
    }
  }

  for (const edge of report.graph.edges) {
    if (!unitIds.has(edge.sourceId)) {
      addFailure(failures, edge.sourceId, "A semantic edge has an unknown source unit");
    }
    if (edge.kind === ReactSemanticEdgeKind.RendersComponent && !unitIds.has(edge.targetId)) {
      addFailure(failures, edge.targetId, "A render edge has an unknown target unit");
    }
  }
  for (const render of report.graph.renders) {
    if (!unitIds.has(render.ownerId) || !unitIds.has(render.targetId)) {
      addFailure(failures, render.id, "A render has an unknown semantic unit");
    }
    if (new Set(render.activeFormIds).size !== render.activeFormIds.length) {
      addFailure(failures, render.id, "A render repeats an active form");
    }
    if (new Set(render.activeContextProviderIds).size !== render.activeContextProviderIds.length) {
      addFailure(failures, render.id, "A render repeats an active context provider");
    }
    if (
      render.topologyOwnerIds.length === 0 ||
      new Set(render.topologyOwnerIds).size !== render.topologyOwnerIds.length ||
      render.topologyOwnerIds.some((ownerId) => !unitIds.has(ownerId))
    ) {
      addFailure(failures, render.id, "A render has inconsistent topology owners");
    }
    const sourceRender = render.sourceRenderId ? rendersById.get(render.sourceRenderId) : null;
    if (
      render.kind === ReactSemanticRenderKind.Direct &&
      (render.sourceRenderId !== null ||
        render.containerRenderId !== null ||
        render.slotPropName !== null ||
        !render.contextTopologyComplete ||
        !render.formTopologyComplete)
    ) {
      addFailure(failures, render.id, "A direct render has slot-only topology facts");
    }
    if (
      render.kind !== ReactSemanticRenderKind.Slot &&
      (render.topologyOwnerIds.length !== 1 || render.topologyOwnerIds[0] !== render.ownerId)
    ) {
      addFailure(failures, render.id, "A non-slot render has inconsistent topology ownership");
    }
    if (render.kind === ReactSemanticRenderKind.SlotInput && render.sourceRenderId !== null) {
      addFailure(failures, render.id, "A slot input has inconsistent source facts");
    }
    if (render.kind === ReactSemanticRenderKind.Slot) {
      if (
        !sourceRender ||
        sourceRender.kind !== ReactSemanticRenderKind.SlotInput ||
        render.slotPropName !== sourceRender.slotPropName ||
        render.containerRenderId !== sourceRender.containerRenderId ||
        !render.topologyOwnerIds.includes(render.ownerId) ||
        !render.topologyOwnerIds.includes(sourceRender.ownerId)
      ) {
        addFailure(failures, render.id, "A slot render has an inconsistent source render");
      }
    } else if (render.sourceRenderId !== null) {
      addFailure(failures, render.id, "A non-slot render references a source render");
    }
    const allowedTopologyOwnerIds = new Set(render.topologyOwnerIds);
    for (const providerId of render.activeContextProviderIds) {
      const provider = providersById.get(providerId);
      if (!provider) {
        addFailure(failures, render.id, "A render has an unknown active context provider");
      } else if (!allowedTopologyOwnerIds.has(provider.ownerId)) {
        addFailure(
          failures,
          render.id,
          "A render has an active context provider owned by an unrelated unit",
        );
      }
    }
    for (const formId of render.activeFormIds) {
      const form = formsById.get(formId);
      if (!form) {
        addFailure(failures, render.id, "A render has an unknown active form");
      } else if (!allowedTopologyOwnerIds.has(form.ownerId)) {
        addFailure(failures, render.id, "A render has an active form owned by an unrelated unit");
      }
    }
  }
  const slotFlowsBySourceRenderId = new Map<string, typeof report.graph.slotFlows>();
  for (const slotFlow of report.graph.slotFlows) {
    const sourceRender = rendersById.get(slotFlow.sourceRenderId);
    const containerRender = slotFlow.containerRenderId
      ? rendersById.get(slotFlow.containerRenderId)
      : null;
    const slotRenders = report.graph.renders.filter(
      (render) => render.sourceRenderId === slotFlow.sourceRenderId,
    );
    if (
      !sourceRender ||
      sourceRender.kind !== ReactSemanticRenderKind.SlotInput ||
      sourceRender.ownerId !== slotFlow.ownerId
    ) {
      addFailure(failures, slotFlow.id, "A slot flow has an inconsistent source render");
    }
    if (slotFlow.containerRenderId && !containerRender) {
      addFailure(failures, slotFlow.id, "A slot flow has an unknown container render");
    }
    if (slotFlow.placementComplete && (!containerRender || !slotFlow.propName)) {
      addFailure(failures, slotFlow.id, "A complete slot flow has no project-local placement");
    }
    if (
      sourceRender &&
      (slotFlow.containerRenderId !== sourceRender.containerRenderId ||
        slotFlow.propName !== sourceRender.slotPropName ||
        slotFlow.complete !== (slotFlow.sourceComplete && slotFlow.placementComplete) ||
        slotFlow.complete !== sourceRender.contextTopologyComplete ||
        slotFlow.complete !== sourceRender.formTopologyComplete)
    ) {
      addFailure(failures, slotFlow.id, "A slot flow disagrees with its source certificate");
    }
    if (new Set(slotFlow.renderIds).size !== slotFlow.renderIds.length) {
      addFailure(failures, slotFlow.id, "A slot flow repeats an effective render");
    }
    if (
      slotFlow.renderIds.length !== slotRenders.length ||
      slotRenders.some((render) => !slotFlow.renderIds.includes(render.id))
    ) {
      addFailure(failures, slotFlow.id, "A slot flow has an inconsistent effective render set");
    }
    for (const renderId of slotFlow.renderIds) {
      const slotRender = rendersById.get(renderId);
      if (
        slotRender?.kind !== ReactSemanticRenderKind.Slot ||
        !slotRender.contextTopologyComplete ||
        !slotRender.formTopologyComplete
      ) {
        addFailure(failures, slotFlow.id, "A slot flow references an invalid effective render");
      }
    }
    const sourceSlotFlows = slotFlowsBySourceRenderId.get(slotFlow.sourceRenderId) ?? [];
    slotFlowsBySourceRenderId.set(slotFlow.sourceRenderId, [...sourceSlotFlows, slotFlow]);
  }
  for (const render of report.graph.renders) {
    if (
      render.kind === ReactSemanticRenderKind.SlotInput &&
      slotFlowsBySourceRenderId.get(render.id)?.length !== 1
    ) {
      addFailure(failures, render.id, "A slot input has no unique slot-flow certificate");
    }
  }
  for (const effect of report.graph.effects) {
    if (!unitIds.has(effect.ownerId)) {
      addFailure(failures, effect.id, "An Effect has an unknown owner unit");
    }
    if (effect.setupCallbackId && !callbackIds.has(effect.setupCallbackId)) {
      addFailure(failures, effect.id, "An Effect has an unknown setup callback");
    }
    for (const cleanupCallbackId of effect.cleanupCallbackIds) {
      if (!callbackIds.has(cleanupCallbackId)) {
        addFailure(failures, effect.id, "An Effect has an unknown cleanup callback");
      }
    }
  }
  for (const externalStore of report.graph.externalStores) {
    const isCertifiedCallbackSource = (callbackId: string, phase: ReactExecutionPhase): boolean => {
      const callback = callbacksById.get(callbackId);
      return Boolean(
        callback &&
        (callback.ownerId === externalStore.ownerId ||
          report.graph.callbackPropFlows.some(
            (propFlow) =>
              propFlow.targetOwnerId === externalStore.ownerId &&
              propFlow.phase === phase &&
              propFlow.complete &&
              propFlow.callbackIds.includes(callbackId),
          )),
      );
    };
    if (!unitIds.has(externalStore.ownerId)) {
      addFailure(failures, externalStore.id, "An external store has an unknown owner unit");
    }
    if (externalStore.subscribeComplete && externalStore.subscribeCallbackIds.length === 0) {
      addFailure(
        failures,
        externalStore.id,
        "A complete external-store subscription has no callback",
      );
    }
    if (externalStore.snapshotComplete && externalStore.snapshotCallbackIds.length === 0) {
      addFailure(failures, externalStore.id, "A complete external-store snapshot has no callback");
    }
    if (
      externalStore.serverSnapshotProvided &&
      externalStore.serverSnapshotComplete &&
      externalStore.serverSnapshotCallbackIds.length === 0
    ) {
      addFailure(
        failures,
        externalStore.id,
        "A complete external-store server snapshot has no callback",
      );
    }
    if (
      !externalStore.serverSnapshotProvided &&
      externalStore.serverSnapshotCallbackIds.length > 0
    ) {
      addFailure(
        failures,
        externalStore.id,
        "An omitted external-store server snapshot has callback facts",
      );
    }
    for (const callbackId of externalStore.subscribeCallbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store subscription has an unknown callback",
        );
      } else if (callback.phase !== ReactExecutionPhase.ExternalStoreSubscription) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store subscription callback has the wrong execution phase",
        );
      } else if (
        !isCertifiedCallbackSource(callbackId, ReactExecutionPhase.ExternalStoreSubscription)
      ) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store subscription callback has no certified owner channel",
        );
      }
    }
    for (const callbackId of externalStore.snapshotCallbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store snapshot has an unknown callback",
        );
      } else if (callback.phase !== ReactExecutionPhase.Render) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store snapshot callback has the wrong execution phase",
        );
      } else if (!isCertifiedCallbackSource(callbackId, ReactExecutionPhase.Render)) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store snapshot callback has no certified owner channel",
        );
      }
    }
    for (const callbackId of externalStore.serverSnapshotCallbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store server snapshot has an unknown callback",
        );
      } else if (callback.phase !== ReactExecutionPhase.ServerRender) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store server snapshot callback has the wrong execution phase",
        );
      } else if (!isCertifiedCallbackSource(callbackId, ReactExecutionPhase.ServerRender)) {
        addFailure(
          failures,
          externalStore.id,
          "An external-store server snapshot callback has no certified owner channel",
        );
      }
    }
  }
  for (const task of report.graph.asyncTasks) {
    if (!unitIds.has(task.ownerId)) {
      addFailure(failures, task.id, "An async task has an unknown owner unit");
    }
    if (!effectIds.has(task.effectId)) {
      addFailure(failures, task.id, "An async task has an unknown source Effect");
    }
  }
  for (const callableRef of report.graph.callableRefs) {
    if (!unitIds.has(callableRef.ownerId)) {
      addFailure(failures, callableRef.id, "A callable ref has an unknown owner unit");
    }
    const declaredInvocationCallbackIds = new Set(callableRef.invocationCallbackIds);
    const invocationCallbackIds = new Set<string>();
    const matchedInvocationLocations = new Set<number>();
    for (const invocationCallId of callableRef.invocationCallIds) {
      const functionCall = functionCallsById.get(invocationCallId);
      if (!functionCall) {
        addFailure(failures, callableRef.id, "A callable ref has an unknown invocation call");
        continue;
      }
      invocationCallbackIds.add(functionCall.rootCallbackId);
      const invocationLocationIndex = callableRef.invocationLocations.findIndex((location) =>
        areProofLocationsEqual(location, functionCall.location),
      );
      if (invocationLocationIndex >= 0) matchedInvocationLocations.add(invocationLocationIndex);
      if (invocationLocationIndex < 0 || functionCall.sourcePropertyPath.at(-1) !== "current") {
        addFailure(
          failures,
          callableRef.id,
          "A callable ref invocation call does not match its source location and ref-current path",
        );
      }
      if (!declaredInvocationCallbackIds.has(functionCall.rootCallbackId)) {
        addFailure(
          failures,
          callableRef.id,
          "A callable ref invocation call has an undeclared root callback",
        );
      }
    }
    if (matchedInvocationLocations.size !== callableRef.invocationLocations.length) {
      addFailure(
        failures,
        callableRef.id,
        "A callable ref invocation location has no serialized call edge",
      );
    }
    for (const invocationCallbackId of callableRef.invocationCallbackIds) {
      const callback = callbacksById.get(invocationCallbackId);
      if (!callback) {
        addFailure(failures, callableRef.id, "A callable ref has an unknown invocation callback");
      } else if (callableRef.complete && callback.phase !== ReactExecutionPhase.Event) {
        addFailure(
          failures,
          callableRef.id,
          "A callable ref invocation is outside the modeled event phase",
        );
      }
      if (!invocationCallbackIds.has(invocationCallbackId)) {
        addFailure(
          failures,
          callableRef.id,
          "A callable ref invocation callback has no ref-current call edge",
        );
      }
    }
    if (
      callableRef.complete &&
      (!callableRef.sourceComplete ||
        callableRef.freshness !== ReactCallableRefFreshness.EventSynchronized ||
        callableRef.updateHookName !== "useLayoutEffect" ||
        !callableRef.updateLocation ||
        callableRef.invocationCallIds.length === 0 ||
        callableRef.invocationCallbackIds.length === 0 ||
        callableRef.invocationLocations.length === 0)
    ) {
      addFailure(
        failures,
        callableRef.id,
        "A complete callable ref lacks a layout-synchronized event certificate",
      );
    }
    if (
      callableRef.freshness === ReactCallableRefFreshness.EventSynchronized &&
      !callableRef.complete
    ) {
      addFailure(
        failures,
        callableRef.id,
        "An event-synchronized callable ref is not marked complete",
      );
    }
    if (
      callableRef.freshness === ReactCallableRefFreshness.PassiveLag &&
      callableRef.updateHookName !== "useEffect"
    ) {
      addFailure(
        failures,
        callableRef.id,
        "A passive-lag callable ref is not updated by useEffect",
      );
    }
  }
  for (const scheduler of report.graph.schedulers) {
    if (!unitIds.has(scheduler.ownerId)) {
      addFailure(failures, scheduler.id, "A scheduler has an unknown owner unit");
    }
    if (scheduler.effectId) {
      const effect = effectsById.get(scheduler.effectId);
      if (!effect || effect.ownerId !== scheduler.ownerId) {
        addFailure(failures, scheduler.id, "A scheduler has an unknown or cross-owner Effect");
      } else if (effect.setupCallbackId !== scheduler.registrationCallbackId) {
        addFailure(
          failures,
          scheduler.id,
          "A scheduler registration is not linked to its Effect setup callback",
        );
      }
    } else {
      const owner = unitsById.get(scheduler.ownerId);
      const registrationCallback = callbacksById.get(scheduler.registrationCallbackId);
      if (
        owner?.kind !== ReactUnitKind.ClassComponent ||
        registrationCallback?.ownerId !== scheduler.ownerId ||
        registrationCallback.kind !== ReactSemanticCallbackKind.ClassMount ||
        registrationCallback.phase !== ReactExecutionPhase.ClassMount
      ) {
        addFailure(failures, scheduler.id, "A class scheduler is not linked to its mount callback");
      }
    }
    for (const callbackId of scheduler.callbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(failures, scheduler.id, "A scheduler has an unknown deferred callback");
      } else if (
        callback.kind !== ReactSemanticCallbackKind.ScheduledCallback ||
        callback.phase !== ReactExecutionPhase.Deferred
      ) {
        addFailure(
          failures,
          scheduler.id,
          "A scheduler callback has the wrong kind or execution phase",
        );
      }
    }
    const expectedComplete =
      scheduler.sourceComplete &&
      scheduler.callbackComplete &&
      scheduler.cancellationStatus === ReactSchedulerCancellationStatus.Guaranteed &&
      scheduler.cancellationLocations.length > 0 &&
      scheduler.callbackIds.length > 0 &&
      scheduler.phase === ReactExecutionPhase.Deferred;
    if (scheduler.complete !== expectedComplete) {
      addFailure(
        failures,
        scheduler.id,
        "A scheduler completeness flag does not match its deferred lifetime certificate",
      );
    }
    if (scheduler.callbackComplete && scheduler.callbackIds.length === 0) {
      addFailure(failures, scheduler.id, "A complete scheduler callback set is empty");
    }
  }
  for (const resource of report.graph.resources) {
    if (!unitIds.has(resource.ownerId)) {
      addFailure(failures, resource.id, "An Effect resource has an unknown owner unit");
    }
    if (resource.effectId) {
      const effect = effectsById.get(resource.effectId);
      if (!effect || effect.ownerId !== resource.ownerId) {
        addFailure(
          failures,
          resource.id,
          "A lifecycle resource has an unknown or cross-owner Effect",
        );
      } else if (effect.setupCallbackId !== resource.acquisitionCallbackId) {
        addFailure(
          failures,
          resource.id,
          "A lifecycle resource acquisition is not linked to its setup callback",
        );
      }
    } else {
      const owner = unitsById.get(resource.ownerId);
      const acquisitionCallback = callbacksById.get(resource.acquisitionCallbackId);
      if (
        owner?.kind !== ReactUnitKind.ClassComponent ||
        acquisitionCallback?.ownerId !== resource.ownerId ||
        acquisitionCallback.kind !== ReactSemanticCallbackKind.ClassMount ||
        acquisitionCallback.phase !== ReactExecutionPhase.ClassMount
      ) {
        addFailure(
          failures,
          resource.id,
          "A class resource acquisition is not linked to its mount callback",
        );
      }
    }
    for (const callbackId of resource.callbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(failures, resource.id, "An Effect resource has an unknown deferred callback");
      } else if (
        !(
          (callback.kind === ReactSemanticCallbackKind.ResourceCallback &&
            callback.phase === ReactExecutionPhase.Deferred) ||
          (callback.kind === ReactSemanticCallbackKind.EffectEvent &&
            callback.phase === ReactExecutionPhase.EffectEvent)
        )
      ) {
        addFailure(
          failures,
          resource.id,
          "An Effect resource callback has the wrong kind or execution phase",
        );
      }
      if (
        callback &&
        callback.ownerId !== resource.ownerId &&
        !report.graph.callbackPropFlows.some(
          (propFlow) =>
            propFlow.targetOwnerId === resource.ownerId &&
            propFlow.phase === ReactExecutionPhase.Deferred &&
            propFlow.complete &&
            propFlow.callbackIds.includes(callbackId),
        )
      ) {
        addFailure(
          failures,
          resource.id,
          "An Effect resource callback has no certified owner channel",
        );
      }
    }
    if (
      resource.activationLocations.length === 0 ||
      !resource.activationLocations.some((activationLocation) =>
        areProofLocationsEqual(activationLocation, resource.location),
      )
    ) {
      addFailure(
        failures,
        resource.id,
        "An Effect resource has no activation location matching its primary location",
      );
    }
    const activationLocationKeys = resource.activationLocations.map(
      (location) => `${location.filePath}:${location.line}:${location.column}`,
    );
    if (new Set(activationLocationKeys).size !== activationLocationKeys.length) {
      addFailure(failures, resource.id, "An Effect resource repeats an activation location");
    }
    if (resource.kind === ReactEffectResourceKind.Observer) {
      addFailure(failures, resource.id, "An Effect resource has an ambiguous observer kind");
    }
    if (
      resource.disposalStatus === ReactEffectResourceDisposalStatus.Guaranteed &&
      resource.disposalLocations.length === 0
    ) {
      addFailure(failures, resource.id, "A guaranteed Effect resource disposal has no evidence");
    }
    const expectedComplete =
      resource.sourceComplete &&
      resource.callbackComplete &&
      resource.disposalStatus === ReactEffectResourceDisposalStatus.Guaranteed &&
      resource.disposalLocations.length > 0 &&
      resource.callbackIds.length > 0 &&
      resource.phase === ReactExecutionPhase.Deferred;
    if (resource.complete !== expectedComplete) {
      addFailure(
        failures,
        resource.id,
        "An Effect resource completeness flag does not match its lifetime certificate",
      );
    }
    if (resource.callbackComplete && resource.callbackIds.length === 0) {
      addFailure(failures, resource.id, "A complete Effect resource callback set is empty");
    }
  }
  const schedulersById = new Map(
    report.graph.schedulers.map((scheduler) => [scheduler.id, scheduler]),
  );
  const resourcesById = new Map(report.graph.resources.map((resource) => [resource.id, resource]));
  const transitionsById = new Map(
    report.graph.classStateTransitions.map((transition) => [transition.id, transition]),
  );
  const actionStatesById = new Map(report.graph.actionStates.map((state) => [state.id, state]));
  for (const state of report.graph.actionStates) {
    const owner = unitsById.get(state.ownerId);
    if (
      !owner ||
      owner.kind === ReactUnitKind.ClassComponent ||
      owner.kind === ReactUnitKind.InvalidHookOwner
    ) {
      addFailure(failures, state.id, "An Action State hook has an unknown or invalid owner");
    }
    if (!state.stateName || !state.dispatcherName) {
      addFailure(failures, state.id, "An Action State hook has an unnamed tuple binding");
    }
    if (!ACTION_STATE_REDUCER_STATUSES.has(state.reducerStatus)) {
      addFailure(failures, state.id, "An Action State hook has an invalid reducer status");
    }
    const reducerCallback = state.reducerCallbackId
      ? callbacksById.get(state.reducerCallbackId)
      : null;
    if (
      (state.reducerStatus === ReactActionStateReducerStatus.Resolved &&
        !state.reducerCallbackId) ||
      (state.reducerStatus === ReactActionStateReducerStatus.Opaque && state.reducerCallbackId) ||
      (state.reducerCallbackId &&
        (reducerCallback?.ownerId !== state.ownerId ||
          reducerCallback.kind !== ReactSemanticCallbackKind.ActionStateReducer ||
          reducerCallback.phase !== ReactExecutionPhase.ActionStateReducer))
    ) {
      addFailure(failures, state.id, "An Action State hook has an invalid reducer Action");
    }
    const expectedSourceComplete =
      state.reducerStatus === ReactActionStateReducerStatus.Resolved && Boolean(reducerCallback);
    if (state.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, state.id, "An Action State source flag is inconsistent");
    }
    if (state.complete !== expectedSourceComplete) {
      addFailure(failures, state.id, "An Action State completeness flag is inconsistent");
    }
  }
  const completeTransitionCallbackIdsForActionState = new Set(
    report.graph.transitionActions.flatMap((action) =>
      action.complete && action.actionCallbackId ? [action.actionCallbackId] : [],
    ),
  );
  for (const dispatch of report.graph.actionStateDispatches) {
    const owner = unitsById.get(dispatch.ownerId);
    const actionState = actionStatesById.get(dispatch.actionStateId);
    if (
      !owner ||
      owner.kind === ReactUnitKind.ClassComponent ||
      owner.kind === ReactUnitKind.InvalidHookOwner
    ) {
      addFailure(failures, dispatch.id, "An Action State dispatch has an invalid owner");
    }
    if (!actionState || actionState.ownerId !== dispatch.ownerId) {
      addFailure(failures, dispatch.id, "An Action State dispatch has an invalid state binding");
    }
    if (!ACTION_STATE_DISPATCH_KINDS.has(dispatch.kind)) {
      addFailure(failures, dispatch.id, "An Action State dispatch has an invalid kind");
    }
    if (!ACTION_STATE_DISPATCH_STATUSES.has(dispatch.status)) {
      addFailure(failures, dispatch.id, "An Action State dispatch has an invalid status");
    }
    if (new Set(dispatch.executionCallbackIds).size !== dispatch.executionCallbackIds.length) {
      addFailure(failures, dispatch.id, "An Action State dispatch repeats an execution callback");
    }
    const executionCallbacks = dispatch.executionCallbackIds.flatMap((callbackId) => {
      const callback = callbacksById.get(callbackId);
      if (!callback || callback.ownerId !== dispatch.ownerId) {
        addFailure(failures, dispatch.id, "An Action State dispatch has an invalid callback");
        return [];
      }
      return [callback];
    });
    let expectedDispatchStatus = ReactActionStateDispatchStatus.Unknown;
    if (dispatch.kind === ReactActionStateDispatchKind.Escape) {
      expectedDispatchStatus = ReactActionStateDispatchStatus.SetterEscape;
    } else if (dispatch.kind === ReactActionStateDispatchKind.ActionProp) {
      const matchingFormAction = report.graph.formActions.find(
        (formAction) =>
          formAction.ownerId === dispatch.ownerId &&
          formAction.complete &&
          areProofLocationsEqual(formAction.location, dispatch.location),
      );
      if (
        matchingFormAction &&
        actionState?.reducerCallbackId &&
        matchingFormAction.actionCallbackIds.includes(actionState.reducerCallbackId)
      ) {
        expectedDispatchStatus = ReactActionStateDispatchStatus.Action;
      }
    } else if (
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Render)
    ) {
      expectedDispatchStatus = ReactActionStateDispatchStatus.Render;
    } else if (
      executionCallbacks.length > 0 &&
      executionCallbacks.every(
        (callback) =>
          callback.phase === ReactExecutionPhase.FormAction ||
          callback.phase === ReactExecutionPhase.ActionStateReducer ||
          (callback.phase === ReactExecutionPhase.TransitionAction &&
            completeTransitionCallbackIdsForActionState.has(callback.id)),
      )
    ) {
      expectedDispatchStatus = ReactActionStateDispatchStatus.Action;
    } else if (
      executionCallbacks.some(
        (callback) =>
          callback.phase !== ReactExecutionPhase.FormAction &&
          callback.phase !== ReactExecutionPhase.ActionStateReducer &&
          callback.phase !== ReactExecutionPhase.TransitionAction,
      )
    ) {
      expectedDispatchStatus = ReactActionStateDispatchStatus.OutsideAction;
    }
    if (dispatch.status !== expectedDispatchStatus) {
      addFailure(failures, dispatch.id, "An Action State dispatch status is inconsistent");
    }
    const expectedSourceComplete =
      Boolean(actionState?.complete) &&
      expectedDispatchStatus !== ReactActionStateDispatchStatus.SetterEscape &&
      expectedDispatchStatus !== ReactActionStateDispatchStatus.Unknown;
    if (dispatch.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, dispatch.id, "An Action State dispatch source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete && expectedDispatchStatus === ReactActionStateDispatchStatus.Action;
    if (dispatch.complete !== expectedComplete) {
      addFailure(failures, dispatch.id, "An Action State dispatch completeness is inconsistent");
    }
  }
  for (const transition of report.graph.hookStateTransitions) {
    const owner = unitsById.get(transition.ownerId);
    if (
      !owner ||
      owner.kind === ReactUnitKind.ClassComponent ||
      owner.kind === ReactUnitKind.InvalidHookOwner
    ) {
      addFailure(
        failures,
        transition.id,
        "A Hook state transition has an unknown or invalid owner",
      );
    }
    if (!transition.stateName || !transition.setterName) {
      addFailure(failures, transition.id, "A Hook state transition has an unnamed binding");
    }
    if (!HOOK_STATE_UPDATER_STATUSES.has(transition.updaterStatus)) {
      addFailure(failures, transition.id, "A Hook state transition has an invalid updater status");
    }
    if (new Set(transition.executionCallbackIds).size !== transition.executionCallbackIds.length) {
      addFailure(failures, transition.id, "A Hook state transition repeats an execution callback");
    }
    for (const callbackId of transition.executionCallbackIds) {
      const executionCallback = callbacksById.get(callbackId);
      if (!executionCallback || executionCallback.ownerId !== transition.ownerId) {
        addFailure(
          failures,
          transition.id,
          "A Hook state transition has an invalid execution callback",
        );
      }
    }
    const updaterCallback = transition.updaterCallbackId
      ? callbacksById.get(transition.updaterCallbackId)
      : null;
    const updaterRequiresCallback =
      transition.updaterStatus === ReactHookStateUpdaterStatus.Pure ||
      transition.updaterStatus === ReactHookStateUpdaterStatus.Impure;
    const updaterForbidsCallback =
      transition.updaterStatus === ReactHookStateUpdaterStatus.DirectValue ||
      transition.updaterStatus === ReactHookStateUpdaterStatus.SetterEscape;
    if (
      (updaterRequiresCallback && !transition.updaterCallbackId) ||
      (updaterForbidsCallback && transition.updaterCallbackId) ||
      (transition.updaterCallbackId &&
        (updaterCallback?.ownerId !== transition.ownerId ||
          updaterCallback.kind !== ReactSemanticCallbackKind.HookStateUpdater ||
          updaterCallback.phase !== ReactExecutionPhase.StateTransition))
    ) {
      addFailure(failures, transition.id, "A Hook state transition has an invalid updater");
    }
    const expectedSourceComplete =
      transition.executionCallbackIds.length > 0 &&
      transition.executionCallbackIds.every(
        (callbackId) =>
          callbacksById.get(callbackId)?.phase !== ReactExecutionPhase.StateTransition,
      ) &&
      transition.updaterStatus !== ReactHookStateUpdaterStatus.SetterEscape &&
      transition.updaterStatus !== ReactHookStateUpdaterStatus.Unknown;
    if (transition.sourceComplete !== expectedSourceComplete) {
      addFailure(
        failures,
        transition.id,
        "A Hook state transition source flag does not match its modeled surface",
      );
    }
    const expectedComplete =
      transition.sourceComplete &&
      (transition.updaterStatus === ReactHookStateUpdaterStatus.DirectValue ||
        transition.updaterStatus === ReactHookStateUpdaterStatus.Pure);
    if (transition.complete !== expectedComplete) {
      addFailure(
        failures,
        transition.id,
        "A Hook state transition completeness flag does not match its certificate",
      );
    }
  }
  const hookStateTransitionsById = new Map(
    report.graph.hookStateTransitions.map((transition) => [transition.id, transition]),
  );
  for (const comparator of report.graph.memoComparators) {
    const owner = comparator.ownerId ? unitsById.get(comparator.ownerId) : null;
    if (
      !comparator.ownerId &&
      !report.projectEvidence.some(
        (evidence) =>
          evidence.description === "React.memo has an unresolved component target" &&
          areProofLocationsEqual(evidence.location, comparator.location),
      )
    ) {
      addFailure(
        failures,
        comparator.id,
        "An unresolved memo comparator lacks project-level evidence",
      );
    }
    if (
      comparator.ownerId &&
      (!owner ||
        owner.kind === ReactUnitKind.ClassComponent ||
        owner.kind === ReactUnitKind.InvalidHookOwner)
    ) {
      addFailure(failures, comparator.id, "A memo comparator has an invalid owner unit");
    }
    if (
      !MEMO_COMPARATOR_KINDS.has(comparator.kind) ||
      !MEMO_COMPARATOR_STATUSES.has(comparator.status)
    ) {
      addFailure(failures, comparator.id, "A memo comparator has an invalid protocol domain");
    }
    if (
      (comparator.kind === ReactMemoComparatorKind.DefaultShallow &&
        comparator.comparatorLocation !== null) ||
      (comparator.kind === ReactMemoComparatorKind.Custom && comparator.comparatorLocation === null)
    ) {
      addFailure(failures, comparator.id, "A memo comparator has an inconsistent source kind");
    }
    const observationPaths = comparator.observations.map((observation) => observation.path);
    if (
      observationPaths.some((observationPath) => observationPath.length === 0) ||
      new Set(observationPaths).size !== observationPaths.length
    ) {
      addFailure(failures, comparator.id, "A memo comparator has invalid prop observations");
    }
    const truePathIdentities = comparator.truePaths.map((truePath) => {
      if (
        truePath.equalPropPaths.some((propPath) => propPath === "*") ||
        new Set(truePath.equalPropPaths).size !== truePath.equalPropPaths.length
      ) {
        addFailure(failures, comparator.id, "A memo true path has invalid prop equalities");
      }
      return `${String(truePath.sourceComplete)}:${truePath.equalPropPaths.toSorted().join(",")}`;
    });
    if (new Set(truePathIdentities).size !== truePathIdentities.length) {
      addFailure(failures, comparator.id, "A memo comparator repeats a true return path");
    }
    if (
      comparator.analysisComplete &&
      comparator.truePaths.some((truePath) => !truePath.sourceComplete)
    ) {
      addFailure(failures, comparator.id, "A memo comparator analysis flag is inconsistent");
    }
    if (
      comparator.kind === ReactMemoComparatorKind.DefaultShallow &&
      (comparator.truePaths.length !== 1 ||
        comparator.truePaths[0]?.sourceComplete !== true ||
        comparator.truePaths[0]?.equalPropPaths.length !== 1 ||
        comparator.truePaths[0]?.equalPropPaths[0] !== "")
    ) {
      addFailure(failures, comparator.id, "A default memo comparator lacks shallow equality");
    }
    const expectedStatus = expectedMemoComparatorStatus(comparator);
    if (comparator.status !== expectedStatus) {
      addFailure(failures, comparator.id, "A memo comparator status is inconsistent");
    }
    const hasUniversalTruePaths =
      comparator.truePaths.length > 0 &&
      comparator.truePaths.every(
        (truePath) => truePath.sourceComplete && truePath.equalPropPaths.includes(""),
      );
    const expectedSourceComplete =
      comparator.ownerId !== null &&
      comparator.analysisComplete &&
      comparator.truePaths.every((truePath) => truePath.sourceComplete) &&
      (comparator.kind === ReactMemoComparatorKind.DefaultShallow ||
        comparator.observationComplete ||
        hasUniversalTruePaths);
    if (comparator.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, comparator.id, "A memo comparator source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete && expectedStatus === ReactMemoComparatorStatus.Equivalent;
    if (comparator.complete !== expectedComplete) {
      addFailure(failures, comparator.id, "A memo comparator completeness flag is inconsistent");
    }
  }
  for (const control of report.graph.hostControls) {
    const owner = unitsById.get(control.ownerId);
    if (!owner || owner.kind === ReactUnitKind.InvalidHookOwner) {
      addFailure(failures, control.id, "A host control has an unknown or invalid owner");
    }
    if (
      !HOST_CONTROL_KINDS.has(control.kind) ||
      !HOST_CONTROL_MUTABILITY_STATUSES.has(control.mutabilityStatus) ||
      !HOST_CONTROL_UPDATE_STATUSES.has(control.updateStatus) ||
      !HOST_CONTROL_VALUE_STATUSES.has(control.valueStatus) ||
      !HOST_CONTROL_STATUSES.has(control.status)
    ) {
      addFailure(failures, control.id, "A host control has an invalid protocol domain");
    }
    const expectedControlledPropName =
      control.kind === ReactHostControlKind.CheckableInput ? "checked" : "value";
    const expectedDefaultPropName =
      control.kind === ReactHostControlKind.CheckableInput ? "defaultChecked" : "defaultValue";
    if (
      control.controlledPropName !== expectedControlledPropName ||
      control.defaultPropName !== expectedDefaultPropName
    ) {
      addFailure(failures, control.id, "A host control uses the wrong ownership props");
    }
    if (
      (control.controlledPropPresent === false &&
        control.valueStatus !== ReactHostControlValueStatus.Absent) ||
      (control.controlledPropPresent === true &&
        control.valueStatus === ReactHostControlValueStatus.Absent) ||
      (control.controlledPropPresent === null &&
        control.valueStatus !== ReactHostControlValueStatus.Unknown)
    ) {
      addFailure(failures, control.id, "A host control value status contradicts prop presence");
    }
    if (Boolean(control.stateName) !== Boolean(control.setterName)) {
      addFailure(failures, control.id, "A host control has a partial state binding");
    }
    if ((!control.controlledPropPresent || !control.stateName) && control.setterName) {
      addFailure(failures, control.id, "A host control has a setter without controlled state");
    }
    if (new Set(control.callbackIds).size !== control.callbackIds.length) {
      addFailure(failures, control.id, "A host control repeats an event callback");
    }
    for (const callbackId of control.callbackIds) {
      const callback = callbacksById.get(callbackId);
      if (
        callback?.ownerId !== control.ownerId ||
        callback.kind !== ReactSemanticCallbackKind.EventHandler ||
        callback.phase !== ReactExecutionPhase.Event
      ) {
        addFailure(failures, control.id, "A host control has an invalid change callback");
      }
    }
    if (new Set(control.transitionIds).size !== control.transitionIds.length) {
      addFailure(failures, control.id, "A host control repeats a state transition");
    }
    for (const transitionId of control.transitionIds) {
      const transition = hookStateTransitionsById.get(transitionId);
      if (
        transition?.ownerId !== control.ownerId ||
        transition.stateName !== control.stateName ||
        transition.setterName !== control.setterName ||
        transition.updaterStatus !== ReactHookStateUpdaterStatus.DirectValue
      ) {
        addFailure(failures, control.id, "A host control has an invalid backing-state transition");
      }
    }
    if (
      control.updateStatus === ReactHostControlUpdateStatus.Exact &&
      (!control.stateName ||
        control.callbackIds.length === 0 ||
        control.transitionIds.length === 0 ||
        control.transitionIds.some(
          (transitionId) => !hookStateTransitionsById.get(transitionId)?.complete,
        ))
    ) {
      addFailure(failures, control.id, "An exact host control update lacks a complete event link");
    }
    if (
      control.controlledPropPresent === false &&
      control.updateStatus !== ReactHostControlUpdateStatus.NotRequired
    ) {
      addFailure(failures, control.id, "An uncontrolled host control requires an update");
    }
    const expectedStatus = expectedHostControlProtocolStatus(control);
    if (control.status !== expectedStatus) {
      addFailure(failures, control.id, "A host control status is inconsistent");
    }
    const expectedSourceComplete =
      expectedStatus !== ReactHostControlStatus.Unknown &&
      control.valueStatus !== ReactHostControlValueStatus.Unknown &&
      control.updateStatus !== ReactHostControlUpdateStatus.Opaque;
    if (control.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, control.id, "A host control source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete && expectedStatus === ReactHostControlStatus.Resolved;
    if (control.complete !== expectedComplete) {
      addFailure(failures, control.id, "A host control completeness flag is inconsistent");
    }
  }
  const reducersById = new Map(report.graph.reducers.map((reducer) => [reducer.id, reducer]));
  for (const reducer of report.graph.reducers) {
    const owner = unitsById.get(reducer.ownerId);
    const reducerCallback = reducer.reducerCallbackId
      ? callbacksById.get(reducer.reducerCallbackId)
      : null;
    const initializerCallback = reducer.initializerCallbackId
      ? callbacksById.get(reducer.initializerCallbackId)
      : null;
    if (
      !owner ||
      owner.kind === ReactUnitKind.ClassComponent ||
      owner.kind === ReactUnitKind.InvalidHookOwner
    ) {
      addFailure(failures, reducer.id, "A reducer has an unknown or invalid owner");
    }
    if (!reducer.stateName || !reducer.dispatcherName) {
      addFailure(failures, reducer.id, "A reducer has an unnamed state or dispatcher binding");
    }
    if (
      !REDUCER_PURITY_STATUSES.has(reducer.reducerPurity) ||
      !REDUCER_PURITY_STATUSES.has(reducer.initializerPurity) ||
      !REDUCER_RETURN_STATUSES.has(reducer.reducerReturnStatus) ||
      !REDUCER_RETURN_STATUSES.has(reducer.initializerReturnStatus)
    ) {
      addFailure(failures, reducer.id, "A reducer has an invalid purity or return status");
    }
    const hasValidReducerCallback =
      reducerCallback?.ownerId === reducer.ownerId &&
      reducerCallback.kind === ReactSemanticCallbackKind.Reducer &&
      reducerCallback.phase === ReactExecutionPhase.StateTransition;
    const hasValidInitializerCallback =
      initializerCallback?.ownerId === reducer.ownerId &&
      initializerCallback.kind === ReactSemanticCallbackKind.ReducerInitializer &&
      initializerCallback.phase === ReactExecutionPhase.StateTransition;
    if (reducer.reducerCallbackId && !hasValidReducerCallback) {
      addFailure(failures, reducer.id, "A reducer has an invalid transition callback");
    }
    if (reducer.initializerCallbackId && !hasValidInitializerCallback) {
      addFailure(failures, reducer.id, "A reducer has an invalid initializer callback");
    }
    if (
      (!reducer.reducerCallbackId &&
        (reducer.reducerPurity !== ReactReducerPurityStatus.Opaque ||
          reducer.reducerReturnStatus !== ReactReducerReturnStatus.Opaque)) ||
      reducer.reducerReturnStatus === ReactReducerReturnStatus.Absent
    ) {
      addFailure(failures, reducer.id, "A reducer callback status is inconsistent");
    }
    const hasAbsentInitializer =
      !reducer.initializerCallbackId &&
      reducer.initializerPurity === ReactReducerPurityStatus.Pure &&
      reducer.initializerReturnStatus === ReactReducerReturnStatus.Absent;
    const hasOpaqueInitializer =
      !reducer.initializerCallbackId &&
      reducer.initializerPurity === ReactReducerPurityStatus.Opaque &&
      reducer.initializerReturnStatus === ReactReducerReturnStatus.Opaque;
    if (!hasAbsentInitializer && !hasOpaqueInitializer && !hasValidInitializerCallback) {
      addFailure(failures, reducer.id, "A reducer initializer status is inconsistent");
    }
    if (
      hasValidInitializerCallback &&
      reducer.initializerReturnStatus === ReactReducerReturnStatus.Absent
    ) {
      addFailure(failures, reducer.id, "A resolved reducer initializer cannot be absent");
    }
    const expectedSourceComplete =
      hasValidReducerCallback &&
      reducer.reducerPurity !== ReactReducerPurityStatus.Opaque &&
      reducer.reducerReturnStatus !== ReactReducerReturnStatus.Opaque &&
      (hasAbsentInitializer ||
        (hasValidInitializerCallback &&
          reducer.initializerPurity !== ReactReducerPurityStatus.Opaque &&
          reducer.initializerReturnStatus !== ReactReducerReturnStatus.Opaque));
    if (reducer.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, reducer.id, "A reducer source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete &&
      reducer.reducerPurity === ReactReducerPurityStatus.Pure &&
      reducer.initializerPurity === ReactReducerPurityStatus.Pure &&
      reducer.reducerReturnStatus === ReactReducerReturnStatus.Total &&
      (reducer.initializerReturnStatus === ReactReducerReturnStatus.Absent ||
        reducer.initializerReturnStatus === ReactReducerReturnStatus.Total);
    if (reducer.complete !== expectedComplete) {
      addFailure(failures, reducer.id, "A reducer completeness flag is inconsistent");
    }
  }
  for (const dispatch of report.graph.reducerDispatches) {
    const reducer = reducersById.get(dispatch.reducerId);
    const executionCallbacks = dispatch.executionCallbackIds.flatMap((callbackId) => {
      const callback = callbacksById.get(callbackId);
      if (!callback || callback.ownerId !== dispatch.ownerId) {
        addFailure(failures, dispatch.id, "A reducer dispatch has an invalid execution callback");
        return [];
      }
      return [callback];
    });
    if (!reducer || reducer.ownerId !== dispatch.ownerId) {
      addFailure(failures, dispatch.id, "A reducer dispatch has an invalid reducer owner");
    }
    if (
      !REDUCER_DISPATCH_KINDS.has(dispatch.kind) ||
      !REDUCER_DISPATCH_STATUSES.has(dispatch.status)
    ) {
      addFailure(failures, dispatch.id, "A reducer dispatch has an invalid kind or status");
    }
    if (new Set(dispatch.executionCallbackIds).size !== dispatch.executionCallbackIds.length) {
      addFailure(failures, dispatch.id, "A reducer dispatch repeats an execution callback");
    }
    let expectedStatus = ReactReducerDispatchStatus.Unknown;
    if (dispatch.kind === ReactReducerDispatchKind.Escape) {
      expectedStatus = ReactReducerDispatchStatus.Escape;
    } else if (
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Render)
    ) {
      expectedStatus = ReactReducerDispatchStatus.Render;
    } else if (
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.StateTransition)
    ) {
      expectedStatus = ReactReducerDispatchStatus.Reducer;
    } else if (executionCallbacks.length > 0) {
      expectedStatus = ReactReducerDispatchStatus.Owned;
    }
    if (
      dispatch.kind === ReactReducerDispatchKind.Escape &&
      dispatch.executionCallbackIds.length > 0
    ) {
      addFailure(failures, dispatch.id, "An escaping reducer dispatch has execution callbacks");
    }
    if (dispatch.status !== expectedStatus) {
      addFailure(failures, dispatch.id, "A reducer dispatch status is inconsistent");
    }
    const expectedSourceComplete =
      Boolean(reducer?.complete) &&
      expectedStatus !== ReactReducerDispatchStatus.Escape &&
      expectedStatus !== ReactReducerDispatchStatus.Unknown;
    if (dispatch.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, dispatch.id, "A reducer dispatch source flag is inconsistent");
    }
    const expectedComplete =
      expectedSourceComplete && expectedStatus === ReactReducerDispatchStatus.Owned;
    if (dispatch.complete !== expectedComplete) {
      addFailure(failures, dispatch.id, "A reducer dispatch completeness flag is inconsistent");
    }
  }
  for (const action of report.graph.formActions) {
    const owner = unitsById.get(action.ownerId);
    if (!owner || owner.kind === ReactUnitKind.InvalidHookOwner) {
      addFailure(failures, action.id, "A Form Action has an unknown or invalid owner");
    }
    if (!FORM_ACTION_KINDS.has(action.kind)) {
      addFailure(failures, action.id, "A Form Action has an invalid control kind");
    }
    if (!FORM_ACTION_STATUSES.has(action.status)) {
      addFailure(failures, action.id, "A Form Action has an invalid status");
    }
    let expectedKind: ReactFormActionKind | null = null;
    if (action.propName === "action") {
      expectedKind = ReactFormActionKind.Form;
    } else if (action.propName === "formAction") {
      expectedKind = ReactFormActionKind.Submitter;
    }
    if (!expectedKind || action.kind !== expectedKind) {
      addFailure(failures, action.id, "A Form Action property contradicts its control kind");
    }
    if (new Set(action.actionCallbackIds).size !== action.actionCallbackIds.length) {
      addFailure(failures, action.id, "A Form Action repeats an Action callback");
    }
    const hasValidCallbacks = action.actionCallbackIds.every((callbackId) => {
      const callback = callbacksById.get(callbackId);
      return Boolean(
        callback &&
        ((callback.kind === ReactSemanticCallbackKind.FormAction &&
          callback.phase === ReactExecutionPhase.FormAction) ||
          (callback.kind === ReactSemanticCallbackKind.ActionStateReducer &&
            callback.phase === ReactExecutionPhase.ActionStateReducer)),
      );
    });
    if (!hasValidCallbacks) {
      addFailure(failures, action.id, "A Form Action has an invalid Action callback");
    }
    if (action.callbackComplete && action.actionCallbackIds.length === 0) {
      addFailure(failures, action.id, "A complete Form Action callback set is empty");
    }
    const expectedSourceComplete =
      action.callbackComplete &&
      hasValidCallbacks &&
      action.status !== ReactFormActionStatus.Opaque;
    if (action.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, action.id, "A Form Action source flag contradicts its callback model");
    }
    const expectedComplete =
      action.sourceComplete && action.status === ReactFormActionStatus.Resolved;
    if (action.complete !== expectedComplete) {
      addFailure(failures, action.id, "A Form Action completeness flag is inconsistent");
    }
  }
  const optimisticStatesById = new Map(
    report.graph.optimisticStates.map((state) => [state.id, state]),
  );
  const completeTransitionCallbackIds = new Set(
    report.graph.transitionActions.flatMap((action) =>
      action.complete && action.actionCallbackId ? [action.actionCallbackId] : [],
    ),
  );
  for (const state of report.graph.optimisticStates) {
    const owner = unitsById.get(state.ownerId);
    if (
      !owner ||
      owner.kind === ReactUnitKind.ClassComponent ||
      owner.kind === ReactUnitKind.InvalidHookOwner
    ) {
      addFailure(failures, state.id, "An optimistic state has an unknown or invalid owner");
    }
    if (!state.stateName || !state.setterName) {
      addFailure(failures, state.id, "An optimistic state has an unnamed tuple binding");
    }
    if (!OPTIMISTIC_REDUCER_STATUSES.has(state.reducerStatus)) {
      addFailure(failures, state.id, "An optimistic state has an invalid reducer status");
    }
    const reducerCallback = state.reducerCallbackId
      ? callbacksById.get(state.reducerCallbackId)
      : null;
    const reducerRequiresCallback =
      state.reducerStatus === ReactOptimisticReducerStatus.Impure ||
      state.reducerStatus === ReactOptimisticReducerStatus.Pure;
    if (
      (reducerRequiresCallback && !state.reducerCallbackId) ||
      (state.reducerStatus === ReactOptimisticReducerStatus.Absent && state.reducerCallbackId) ||
      (state.reducerCallbackId &&
        (reducerCallback?.ownerId !== state.ownerId ||
          reducerCallback.kind !== ReactSemanticCallbackKind.OptimisticReducer ||
          reducerCallback.phase !== ReactExecutionPhase.OptimisticReducer))
    ) {
      addFailure(failures, state.id, "An optimistic state has an invalid reducer callback");
    }
    const expectedSourceComplete =
      state.reducerStatus === ReactOptimisticReducerStatus.Absent ||
      (reducerRequiresCallback && Boolean(reducerCallback));
    if (state.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, state.id, "An optimistic state source flag is inconsistent");
    }
    const expectedComplete =
      state.sourceComplete &&
      (state.reducerStatus === ReactOptimisticReducerStatus.Absent ||
        state.reducerStatus === ReactOptimisticReducerStatus.Pure);
    if (state.complete !== expectedComplete) {
      addFailure(failures, state.id, "An optimistic state completeness flag is inconsistent");
    }
  }
  for (const update of report.graph.optimisticUpdates) {
    const owner = unitsById.get(update.ownerId);
    const optimisticState = optimisticStatesById.get(update.optimisticStateId);
    if (
      !owner ||
      owner.kind === ReactUnitKind.ClassComponent ||
      owner.kind === ReactUnitKind.InvalidHookOwner
    ) {
      addFailure(failures, update.id, "An optimistic update has an unknown or invalid owner");
    }
    if (!optimisticState || optimisticState.ownerId !== update.ownerId) {
      addFailure(failures, update.id, "An optimistic update has an invalid state binding");
    }
    if (!HOOK_STATE_UPDATER_STATUSES.has(update.updaterStatus)) {
      addFailure(failures, update.id, "An optimistic update has an invalid updater status");
    }
    if (!OPTIMISTIC_ACTION_STATUSES.has(update.actionStatus)) {
      addFailure(failures, update.id, "An optimistic update has an invalid Action status");
    }
    if (new Set(update.executionCallbackIds).size !== update.executionCallbackIds.length) {
      addFailure(failures, update.id, "An optimistic update repeats an execution callback");
    }
    const executionCallbacks = update.executionCallbackIds.flatMap((callbackId) => {
      const callback = callbacksById.get(callbackId);
      if (!callback || callback.ownerId !== update.ownerId) {
        addFailure(failures, update.id, "An optimistic update has an invalid execution callback");
        return [];
      }
      return [callback];
    });
    let expectedActionStatus = ReactOptimisticActionStatus.Unknown;
    if (executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Render)) {
      expectedActionStatus = ReactOptimisticActionStatus.Render;
    } else if (
      executionCallbacks.length > 0 &&
      executionCallbacks.every(
        (callback) =>
          callback.phase === ReactExecutionPhase.FormAction ||
          callback.phase === ReactExecutionPhase.ActionStateReducer ||
          (callback.phase === ReactExecutionPhase.TransitionAction &&
            completeTransitionCallbackIds.has(callback.id)),
      )
    ) {
      expectedActionStatus = ReactOptimisticActionStatus.Action;
    } else if (
      executionCallbacks.some(
        (callback) =>
          callback.phase !== ReactExecutionPhase.FormAction &&
          callback.phase !== ReactExecutionPhase.ActionStateReducer &&
          callback.phase !== ReactExecutionPhase.TransitionAction,
      )
    ) {
      expectedActionStatus = ReactOptimisticActionStatus.OutsideAction;
    }
    if (update.actionStatus !== expectedActionStatus) {
      addFailure(failures, update.id, "An optimistic update Action status is inconsistent");
    }
    const updaterCallback = update.updaterCallbackId
      ? callbacksById.get(update.updaterCallbackId)
      : null;
    const updaterRequiresCallback =
      update.updaterStatus === ReactHookStateUpdaterStatus.Impure ||
      update.updaterStatus === ReactHookStateUpdaterStatus.Pure;
    const updaterForbidsCallback =
      update.updaterStatus === ReactHookStateUpdaterStatus.DirectValue ||
      update.updaterStatus === ReactHookStateUpdaterStatus.SetterEscape;
    if (
      (updaterRequiresCallback && !update.updaterCallbackId) ||
      (updaterForbidsCallback && update.updaterCallbackId) ||
      (update.updaterCallbackId &&
        (updaterCallback?.ownerId !== update.ownerId ||
          updaterCallback.kind !== ReactSemanticCallbackKind.OptimisticUpdater ||
          updaterCallback.phase !== ReactExecutionPhase.OptimisticUpdater))
    ) {
      addFailure(failures, update.id, "An optimistic update has an invalid updater callback");
    }
    const expectedSourceComplete =
      Boolean(optimisticState) &&
      expectedActionStatus !== ReactOptimisticActionStatus.Unknown &&
      update.updaterStatus !== ReactHookStateUpdaterStatus.SetterEscape &&
      update.updaterStatus !== ReactHookStateUpdaterStatus.Unknown;
    if (update.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, update.id, "An optimistic update source flag is inconsistent");
    }
    const expectedComplete =
      update.sourceComplete &&
      expectedActionStatus === ReactOptimisticActionStatus.Action &&
      (update.updaterStatus === ReactHookStateUpdaterStatus.DirectValue ||
        update.updaterStatus === ReactHookStateUpdaterStatus.Pure);
    if (update.complete !== expectedComplete) {
      addFailure(failures, update.id, "An optimistic update completeness flag is inconsistent");
    }
  }
  for (const action of report.graph.transitionActions) {
    const owner = unitsById.get(action.ownerId);
    if (!owner || owner.kind === ReactUnitKind.InvalidHookOwner) {
      addFailure(failures, action.id, "A Transition Action has an unknown or invalid owner");
    }
    if (!TRANSITION_STARTER_KINDS.has(action.starterKind)) {
      addFailure(failures, action.id, "A Transition Action has an invalid starter kind");
    }
    if (!TRANSITION_ACTION_STATUSES.has(action.status)) {
      addFailure(failures, action.id, "A Transition Action has an invalid status");
    }
    if (new Set(action.executionCallbackIds).size !== action.executionCallbackIds.length) {
      addFailure(failures, action.id, "A Transition Action repeats an execution callback");
    }
    for (const callbackId of action.executionCallbackIds) {
      const executionCallback = callbacksById.get(callbackId);
      if (!executionCallback || executionCallback.ownerId !== action.ownerId) {
        addFailure(failures, action.id, "A Transition Action has an invalid execution callback");
      }
    }
    const actionCallback = action.actionCallbackId
      ? callbacksById.get(action.actionCallbackId)
      : null;
    const statusRequiresCallback =
      action.status !== ReactTransitionActionStatus.Opaque &&
      action.status !== ReactTransitionActionStatus.StarterEscape;
    if (
      (statusRequiresCallback && !action.actionCallbackId) ||
      (!statusRequiresCallback && action.actionCallbackId) ||
      (action.actionCallbackId &&
        (actionCallback?.ownerId !== action.ownerId ||
          actionCallback.kind !== ReactSemanticCallbackKind.TransitionAction ||
          actionCallback.phase !== ReactExecutionPhase.TransitionAction))
    ) {
      addFailure(failures, action.id, "A Transition Action has an invalid Action callback");
    }
    const controlledStateNames = new Set(action.controlledStateNames);
    const unknownControlStateNames = new Set(action.unknownControlStateNames);
    if (
      controlledStateNames.size !== action.controlledStateNames.length ||
      unknownControlStateNames.size !== action.unknownControlStateNames.length ||
      action.controlledStateNames.some((stateName) => !stateName) ||
      action.unknownControlStateNames.some((stateName) => !stateName)
    ) {
      addFailure(failures, action.id, "A Transition Action has invalid state-control evidence");
    }
    if (
      (action.status === ReactTransitionActionStatus.ControlledInput) !==
        action.controlledStateNames.length > 0 ||
      (action.status === ReactTransitionActionStatus.UnknownControl) !==
        action.unknownControlStateNames.length > 0
    ) {
      addFailure(failures, action.id, "A Transition Action status contradicts its state controls");
    }
    if (
      action.status === ReactTransitionActionStatus.StarterEscape &&
      action.executionCallbackIds.length > 0
    ) {
      addFailure(failures, action.id, "An escaped Transition starter has an execution callback");
    }
    const hasValidExecutionRoot =
      action.executionCallbackIds.length > 0 &&
      action.executionCallbackIds.every((callbackId) => {
        const callback = callbacksById.get(callbackId);
        return Boolean(
          callback &&
          callback.ownerId === action.ownerId &&
          TRANSITION_ACTION_ORIGIN_PHASES.has(callback.phase),
        );
      });
    const hasCompleteSourceStatus =
      action.status === ReactTransitionActionStatus.Synchronous ||
      action.status === ReactTransitionActionStatus.ControlledInput;
    const expectedSourceComplete =
      hasValidExecutionRoot && Boolean(actionCallback) && hasCompleteSourceStatus;
    if (action.sourceComplete !== expectedSourceComplete) {
      addFailure(
        failures,
        action.id,
        "A Transition Action source flag does not match its modeled surface",
      );
    }
    const expectedComplete =
      action.sourceComplete && action.status === ReactTransitionActionStatus.Synchronous;
    if (action.complete !== expectedComplete) {
      addFailure(
        failures,
        action.id,
        "A Transition Action completeness flag does not match its certificate",
      );
    }
  }
  const stateWritesById = new Map(
    report.graph.classStateWrites.map((stateWrite) => [stateWrite.id, stateWrite]),
  );
  const constructionsById = new Map(
    report.graph.classConstructions.map((construction) => [construction.id, construction]),
  );
  const constructionOwnerIds = new Set<string>();
  for (const construction of report.graph.classConstructions) {
    const owner = unitsById.get(construction.ownerId);
    if (owner?.kind !== ReactUnitKind.ClassComponent) {
      addFailure(
        failures,
        construction.id,
        "A class construction has an unknown or non-class owner",
      );
    }
    if (constructionOwnerIds.has(construction.ownerId)) {
      addFailure(
        failures,
        construction.id,
        "A class component has multiple construction certificates",
      );
    }
    constructionOwnerIds.add(construction.ownerId);
    if (construction.phase !== ReactExecutionPhase.ClassConstruction) {
      addFailure(failures, construction.id, "A class construction has an invalid phase");
    }
    if (
      !Object.values(ReactClassStateInitializationKind).includes(construction.initializationKind)
    ) {
      addFailure(
        failures,
        construction.id,
        "A class construction has an invalid initialization kind",
      );
    }
    if (
      !Object.values(ReactClassStateInitializationRequirement).includes(
        construction.stateRequirement,
      )
    ) {
      addFailure(
        failures,
        construction.id,
        "A class construction has an invalid state requirement",
      );
    }
    const hasInitialization =
      construction.initializationKind !== ReactClassStateInitializationKind.None;
    if (hasInitialization !== Boolean(construction.initializationLocation)) {
      addFailure(
        failures,
        construction.id,
        "A class construction initialization kind and location disagree",
      );
    }
    const hasMissingInitializationIssue = construction.issues.some(
      (issue) => issue.kind === ReactClassConstructionIssueKind.MissingStateInitialization,
    );
    if (
      (construction.initializationKind === ReactClassStateInitializationKind.None &&
        construction.stateRequirement !== ReactClassStateInitializationRequirement.None) !==
      hasMissingInitializationIssue
    ) {
      addFailure(
        failures,
        construction.id,
        "A class construction has inconsistent missing-state evidence",
      );
    }
    const hasMultipleInitializationIssue = construction.issues.some(
      (issue) => issue.kind === ReactClassConstructionIssueKind.MultipleStateInitializations,
    );
    if (
      (construction.initializationKind === ReactClassStateInitializationKind.Multiple) !==
      hasMultipleInitializationIssue
    ) {
      addFailure(
        failures,
        construction.id,
        "A class construction has inconsistent multiple-initialization evidence",
      );
    }
    if (
      construction.initializationKind === ReactClassStateInitializationKind.ConstructorAssignment &&
      !construction.constructorLocation
    ) {
      addFailure(
        failures,
        construction.id,
        "A constructor state assignment has no constructor location",
      );
    }
    const issueIdentities = construction.issues.map(
      (issue) =>
        `${issue.kind}:${issue.status}:${issue.location.filePath}:${issue.location.line}:${issue.location.column}`,
    );
    if (new Set(issueIdentities).size !== issueIdentities.length) {
      addFailure(failures, construction.id, "A class construction repeats an issue");
    }
    for (const issue of construction.issues) {
      if (!Object.values(ReactClassConstructionIssueKind).includes(issue.kind)) {
        addFailure(failures, construction.id, "A class construction has an invalid issue kind");
      }
      if (!Object.values(ReactClassConstructionIssueStatus).includes(issue.status)) {
        addFailure(failures, construction.id, "A class construction has an invalid issue status");
      }
    }
    let expectedStatus = ReactClassConstructionStatus.Valid;
    if (
      construction.issues.some(
        (issue) => issue.status === ReactClassConstructionIssueStatus.Violated,
      )
    ) {
      expectedStatus = ReactClassConstructionStatus.Invalid;
    } else if (
      construction.issues.some(
        (issue) => issue.status === ReactClassConstructionIssueStatus.Unknown,
      )
    ) {
      expectedStatus = ReactClassConstructionStatus.Unknown;
    }
    if (construction.status !== expectedStatus) {
      addFailure(
        failures,
        construction.id,
        "A class construction status does not match its issues",
      );
    }
    if (
      construction.sourceComplete !==
      (construction.status !== ReactClassConstructionStatus.Unknown)
    ) {
      addFailure(
        failures,
        construction.id,
        "A class construction source flag does not match its status",
      );
    }
    if (construction.complete !== (construction.status === ReactClassConstructionStatus.Valid)) {
      addFailure(
        failures,
        construction.id,
        "A class construction completeness flag does not match its status",
      );
    }
  }
  for (const stateWrite of report.graph.classStateWrites) {
    if (!Object.values(ReactClassStateWriteKind).includes(stateWrite.kind)) {
      addFailure(failures, stateWrite.id, "A class state write has an invalid write kind");
    }
    if (!Object.values(ReactClassStateWriteStatus).includes(stateWrite.status)) {
      addFailure(failures, stateWrite.id, "A class state write has an invalid ownership status");
    }
    if (
      stateWrite.phase !== ReactExecutionPhase.ClassMount &&
      stateWrite.phase !== ReactExecutionPhase.ClassUnmount &&
      stateWrite.phase !== ReactExecutionPhase.ClassUpdate &&
      stateWrite.phase !== ReactExecutionPhase.Deferred &&
      stateWrite.phase !== ReactExecutionPhase.StateTransition
    ) {
      addFailure(failures, stateWrite.id, "A class state write has an invalid execution phase");
    }
    const owner = unitsById.get(stateWrite.ownerId);
    if (owner?.kind !== ReactUnitKind.ClassComponent) {
      addFailure(failures, stateWrite.id, "A class state write has an unknown or non-class owner");
    }
    const callback = callbacksById.get(stateWrite.callbackId);
    let hasExpectedCallbackKind = false;
    if (stateWrite.phase === ReactExecutionPhase.ClassMount) {
      hasExpectedCallbackKind = callback?.kind === ReactSemanticCallbackKind.ClassMount;
    } else if (stateWrite.phase === ReactExecutionPhase.ClassUnmount) {
      hasExpectedCallbackKind = callback?.kind === ReactSemanticCallbackKind.ClassUnmount;
    } else if (stateWrite.phase === ReactExecutionPhase.ClassUpdate) {
      hasExpectedCallbackKind = callback?.kind === ReactSemanticCallbackKind.ClassUpdate;
    } else if (stateWrite.phase === ReactExecutionPhase.StateTransition) {
      hasExpectedCallbackKind = callback?.kind === ReactSemanticCallbackKind.ClassStateUpdater;
    } else {
      hasExpectedCallbackKind =
        callback?.kind === ReactSemanticCallbackKind.ResourceCallback ||
        callback?.kind === ReactSemanticCallbackKind.ScheduledCallback;
    }
    if (
      callback?.ownerId !== stateWrite.ownerId ||
      !hasExpectedCallbackKind ||
      callback.phase !== stateWrite.phase
    ) {
      addFailure(failures, stateWrite.id, "A class state write has an invalid callback");
    }
    const lifecycle = report.graph.classLifecycles.find(
      (candidate) => candidate.ownerId === stateWrite.ownerId,
    );
    let hasOwnershipLink = false;
    if (stateWrite.phase === ReactExecutionPhase.ClassMount) {
      hasOwnershipLink = lifecycle?.mountCallbackId === stateWrite.callbackId;
    } else if (stateWrite.phase === ReactExecutionPhase.ClassUnmount) {
      hasOwnershipLink = lifecycle?.unmountCallbackId === stateWrite.callbackId;
    } else if (stateWrite.phase === ReactExecutionPhase.ClassUpdate) {
      hasOwnershipLink = lifecycle?.updateCallbackId === stateWrite.callbackId;
    } else if (stateWrite.phase === ReactExecutionPhase.StateTransition) {
      hasOwnershipLink = Boolean(
        lifecycle?.transitionIds.some(
          (transitionId) =>
            transitionsById.get(transitionId)?.updaterCallbackId === stateWrite.callbackId,
        ),
      );
    } else {
      hasOwnershipLink = Boolean(
        lifecycle?.resourceIds.some((resourceId) =>
          resourcesById.get(resourceId)?.callbackIds.includes(stateWrite.callbackId),
        ) ||
        lifecycle?.schedulerIds.some((schedulerId) =>
          schedulersById.get(schedulerId)?.callbackIds.includes(stateWrite.callbackId),
        ),
      );
    }
    if (!hasOwnershipLink) {
      addFailure(
        failures,
        stateWrite.id,
        "A class state write is not linked to its owner callback",
      );
    }
    const expectedSourceComplete = stateWrite.status !== ReactClassStateWriteStatus.Unknown;
    if (stateWrite.sourceComplete !== expectedSourceComplete) {
      addFailure(
        failures,
        stateWrite.id,
        "A class state write source flag does not match its ownership status",
      );
    }
    if (stateWrite.complete) {
      addFailure(failures, stateWrite.id, "A forbidden or unknown class state write is complete");
    }
  }
  for (const transition of report.graph.classStateTransitions) {
    const owner = unitsById.get(transition.ownerId);
    if (owner?.kind !== ReactUnitKind.ClassComponent) {
      addFailure(
        failures,
        transition.id,
        "A class state transition has an unknown or non-class owner",
      );
    }
    const lifecycleCallback = callbacksById.get(transition.lifecycleCallbackId);
    const expectedLifecycleKind =
      transition.phase === ReactExecutionPhase.ClassMount
        ? ReactSemanticCallbackKind.ClassMount
        : ReactSemanticCallbackKind.ClassUpdate;
    if (
      lifecycleCallback?.ownerId !== transition.ownerId ||
      lifecycleCallback.kind !== expectedLifecycleKind ||
      lifecycleCallback.phase !== transition.phase
    ) {
      addFailure(failures, transition.id, "A class state transition has an invalid lifecycle");
    }
    const updaterCallback = transition.updaterCallbackId
      ? callbacksById.get(transition.updaterCallbackId)
      : null;
    const updaterRequiresCallback =
      transition.updaterStatus === ReactClassStateUpdaterStatus.Pure ||
      transition.updaterStatus === ReactClassStateUpdaterStatus.Impure;
    const updaterForbidsCallback =
      transition.updaterStatus === ReactClassStateUpdaterStatus.Noop ||
      transition.updaterStatus === ReactClassStateUpdaterStatus.Object;
    if (
      (updaterRequiresCallback && !transition.updaterCallbackId) ||
      (updaterForbidsCallback && transition.updaterCallbackId) ||
      (transition.updaterCallbackId &&
        (updaterCallback?.ownerId !== transition.ownerId ||
          updaterCallback.kind !== ReactSemanticCallbackKind.ClassStateUpdater ||
          updaterCallback.phase !== ReactExecutionPhase.StateTransition))
    ) {
      addFailure(failures, transition.id, "A class state transition has an invalid updater");
    }
    const expectsGuard = transition.cycleStatus === ReactClassUpdateCycleStatus.Bounded;
    const hasGuard = transition.guardLocations.length > 0;
    if (expectsGuard !== hasGuard) {
      addFailure(failures, transition.id, "A bounded class state transition has invalid guards");
    }
    const expectedSourceComplete =
      transition.updaterStatus !== ReactClassStateUpdaterStatus.Unknown &&
      !transition.commitCallbackProvided;
    if (transition.sourceComplete !== expectedSourceComplete) {
      addFailure(
        failures,
        transition.id,
        "A class state transition source flag does not match its modeled surface",
      );
    }
    const hasSafeUpdater =
      transition.updaterStatus !== ReactClassStateUpdaterStatus.Impure &&
      transition.updaterStatus !== ReactClassStateUpdaterStatus.Unknown;
    const hasSafeCycle =
      transition.cycleStatus !== ReactClassUpdateCycleStatus.Guaranteed &&
      transition.cycleStatus !== ReactClassUpdateCycleStatus.Unknown;
    const expectedComplete =
      transition.sourceComplete && hasSafeUpdater && hasSafeCycle && Boolean(lifecycleCallback);
    if (transition.complete !== expectedComplete) {
      addFailure(
        failures,
        transition.id,
        "A class state transition completeness flag does not match its certificate",
      );
    }
  }
  const lifecycleOwnerIds = new Set<string>();
  for (const lifecycle of report.graph.classLifecycles) {
    const owner = unitsById.get(lifecycle.ownerId);
    if (owner?.kind !== ReactUnitKind.ClassComponent) {
      addFailure(failures, lifecycle.id, "A class lifecycle has an unknown or non-class owner");
    }
    if (lifecycleOwnerIds.has(lifecycle.ownerId)) {
      addFailure(failures, lifecycle.id, "A class component has multiple lifecycle certificates");
    }
    lifecycleOwnerIds.add(lifecycle.ownerId);
    const construction = constructionsById.get(lifecycle.constructionId);
    if (!construction || construction.ownerId !== lifecycle.ownerId) {
      addFailure(failures, lifecycle.id, "A class lifecycle has an invalid construction link");
    }
    if (lifecycle.sourceComplete && !construction?.sourceComplete) {
      addFailure(
        failures,
        lifecycle.id,
        "A class lifecycle is source-complete without complete construction source",
      );
    }
    const mountCallback = lifecycle.mountCallbackId
      ? callbacksById.get(lifecycle.mountCallbackId)
      : null;
    if (
      lifecycle.mountCallbackId &&
      (mountCallback?.ownerId !== lifecycle.ownerId ||
        mountCallback.kind !== ReactSemanticCallbackKind.ClassMount ||
        mountCallback.phase !== ReactExecutionPhase.ClassMount)
    ) {
      addFailure(failures, lifecycle.id, "A class lifecycle has an invalid mount callback");
    }
    const unmountCallback = lifecycle.unmountCallbackId
      ? callbacksById.get(lifecycle.unmountCallbackId)
      : null;
    if (
      lifecycle.unmountCallbackId &&
      (unmountCallback?.ownerId !== lifecycle.ownerId ||
        unmountCallback.kind !== ReactSemanticCallbackKind.ClassUnmount ||
        unmountCallback.phase !== ReactExecutionPhase.ClassUnmount)
    ) {
      addFailure(failures, lifecycle.id, "A class lifecycle has an invalid unmount callback");
    }
    const updateCallback = lifecycle.updateCallbackId
      ? callbacksById.get(lifecycle.updateCallbackId)
      : null;
    if (
      lifecycle.updateCallbackId &&
      (updateCallback?.ownerId !== lifecycle.ownerId ||
        updateCallback.kind !== ReactSemanticCallbackKind.ClassUpdate ||
        updateCallback.phase !== ReactExecutionPhase.ClassUpdate)
    ) {
      addFailure(failures, lifecycle.id, "A class lifecycle has an invalid update callback");
    }
    const lifecycleResources = lifecycle.resourceIds.flatMap((resourceId) => {
      const resource = resourcesById.get(resourceId);
      if (!resource || resource.ownerId !== lifecycle.ownerId || resource.effectId !== null) {
        addFailure(failures, lifecycle.id, "A class lifecycle has an invalid resource link");
        return [];
      }
      return [resource];
    });
    if (new Set(lifecycle.resourceIds).size !== lifecycle.resourceIds.length) {
      addFailure(failures, lifecycle.id, "A class lifecycle repeats a resource link");
    }
    const lifecycleSchedulers = lifecycle.schedulerIds.flatMap((schedulerId) => {
      const scheduler = schedulersById.get(schedulerId);
      if (!scheduler || scheduler.ownerId !== lifecycle.ownerId || scheduler.effectId !== null) {
        addFailure(failures, lifecycle.id, "A class lifecycle has an invalid scheduler link");
        return [];
      }
      return [scheduler];
    });
    if (new Set(lifecycle.schedulerIds).size !== lifecycle.schedulerIds.length) {
      addFailure(failures, lifecycle.id, "A class lifecycle repeats a scheduler link");
    }
    const lifecycleTransitions = lifecycle.transitionIds.flatMap((transitionId) => {
      const transition = transitionsById.get(transitionId);
      if (!transition || transition.ownerId !== lifecycle.ownerId) {
        addFailure(
          failures,
          lifecycle.id,
          "A class lifecycle has an invalid state transition link",
        );
        return [];
      }
      return [transition];
    });
    if (new Set(lifecycle.transitionIds).size !== lifecycle.transitionIds.length) {
      addFailure(failures, lifecycle.id, "A class lifecycle repeats a state transition link");
    }
    const lifecycleStateWrites = lifecycle.stateWriteIds.flatMap((stateWriteId) => {
      const stateWrite = stateWritesById.get(stateWriteId);
      if (!stateWrite || stateWrite.ownerId !== lifecycle.ownerId) {
        addFailure(failures, lifecycle.id, "A class lifecycle has an invalid state write link");
        return [];
      }
      return [stateWrite];
    });
    if (new Set(lifecycle.stateWriteIds).size !== lifecycle.stateWriteIds.length) {
      addFailure(failures, lifecycle.id, "A class lifecycle repeats a state write link");
    }
    const expectedComplete =
      lifecycle.sourceComplete &&
      Boolean(construction?.complete) &&
      lifecycleResources.length === lifecycle.resourceIds.length &&
      lifecycleResources.every((resource) => resource.complete) &&
      lifecycleSchedulers.length === lifecycle.schedulerIds.length &&
      lifecycleSchedulers.every((scheduler) => scheduler.complete) &&
      lifecycleStateWrites.length === lifecycle.stateWriteIds.length &&
      lifecycleStateWrites.every((stateWrite) => stateWrite.complete) &&
      lifecycleTransitions.length === lifecycle.transitionIds.length &&
      lifecycleTransitions.every((transition) => transition.complete);
    if (lifecycle.complete !== expectedComplete) {
      addFailure(
        failures,
        lifecycle.id,
        "A class lifecycle completeness flag does not match its ownership certificates",
      );
    }
  }
  for (const unit of report.graph.units) {
    if (unit.kind === ReactUnitKind.ClassComponent && !lifecycleOwnerIds.has(unit.id)) {
      addFailure(failures, unit.id, "A class component has no lifecycle certificate");
    }
    if (unit.kind === ReactUnitKind.ClassComponent && !constructionOwnerIds.has(unit.id)) {
      addFailure(failures, unit.id, "A class component has no construction certificate");
    }
  }
  for (const scheduler of report.graph.schedulers) {
    if (
      scheduler.effectId === null &&
      !report.graph.classLifecycles.some(
        (lifecycle) =>
          lifecycle.ownerId === scheduler.ownerId && lifecycle.schedulerIds.includes(scheduler.id),
      )
    ) {
      addFailure(failures, scheduler.id, "A class scheduler has no lifecycle certificate");
    }
  }
  for (const resource of report.graph.resources) {
    if (
      resource.effectId === null &&
      !report.graph.classLifecycles.some(
        (lifecycle) =>
          lifecycle.ownerId === resource.ownerId && lifecycle.resourceIds.includes(resource.id),
      )
    ) {
      addFailure(failures, resource.id, "A class resource has no lifecycle certificate");
    }
  }
  for (const transition of report.graph.classStateTransitions) {
    if (
      !report.graph.classLifecycles.some(
        (lifecycle) =>
          lifecycle.ownerId === transition.ownerId &&
          lifecycle.transitionIds.includes(transition.id),
      )
    ) {
      addFailure(failures, transition.id, "A class state transition has no lifecycle certificate");
    }
  }
  for (const stateWrite of report.graph.classStateWrites) {
    if (
      !report.graph.classLifecycles.some(
        (lifecycle) =>
          lifecycle.ownerId === stateWrite.ownerId &&
          lifecycle.stateWriteIds.includes(stateWrite.id),
      )
    ) {
      addFailure(failures, stateWrite.id, "A class state write has no lifecycle certificate");
    }
  }
  for (const construction of report.graph.classConstructions) {
    if (
      !report.graph.classLifecycles.some(
        (lifecycle) =>
          lifecycle.ownerId === construction.ownerId &&
          lifecycle.constructionId === construction.id,
      )
    ) {
      addFailure(failures, construction.id, "A class construction has no lifecycle certificate");
    }
  }
  for (const reachableFunction of report.graph.reachableFunctions) {
    if (!unitIds.has(reachableFunction.ownerId)) {
      addFailure(failures, reachableFunction.id, "A reachable function has an unknown owner unit");
    }
    const rootCallback = callbacksById.get(reachableFunction.rootCallbackId);
    if (!rootCallback) {
      addFailure(
        failures,
        reachableFunction.id,
        "A reachable function has an unknown root callback",
      );
    } else {
      if (rootCallback.ownerId !== reachableFunction.ownerId) {
        addFailure(
          failures,
          reachableFunction.id,
          "A reachable function and root callback have different owners",
        );
      }
      if (rootCallback.phase !== reachableFunction.phase) {
        addFailure(
          failures,
          reachableFunction.id,
          "A reachable function and root callback have different execution phases",
        );
      }
    }
  }
  for (const functionCall of report.graph.functionCalls) {
    if (!unitIds.has(functionCall.ownerId)) {
      addFailure(failures, functionCall.id, "A function call has an unknown owner unit");
    }
    const rootCallback = callbacksById.get(functionCall.rootCallbackId);
    if (!rootCallback) {
      addFailure(failures, functionCall.id, "A function call has an unknown root callback");
      continue;
    }
    const sourceFunction =
      functionCall.sourceFunctionId === rootCallback.id
        ? rootCallback
        : reachableFunctionsById.get(functionCall.sourceFunctionId);
    const targetFunction =
      functionCall.targetFunctionId === rootCallback.id
        ? rootCallback
        : reachableFunctionsById.get(functionCall.targetFunctionId);
    if (!sourceFunction || !targetFunction) {
      addFailure(
        failures,
        functionCall.id,
        "A function call references a function outside its callback graph",
      );
    }
    const sourceRootCallbackId =
      functionCall.sourceFunctionId === rootCallback.id
        ? rootCallback.id
        : reachableFunctionsById.get(functionCall.sourceFunctionId)?.rootCallbackId;
    const targetRootCallbackId =
      functionCall.targetFunctionId === rootCallback.id
        ? rootCallback.id
        : reachableFunctionsById.get(functionCall.targetFunctionId)?.rootCallbackId;
    if (sourceRootCallbackId !== rootCallback.id || targetRootCallbackId !== rootCallback.id) {
      addFailure(failures, functionCall.id, "A function call crosses callback graph roots");
    }
    if (
      rootCallback.ownerId !== functionCall.ownerId ||
      sourceFunction?.ownerId !== functionCall.ownerId ||
      targetFunction?.ownerId !== functionCall.ownerId
    ) {
      addFailure(failures, functionCall.id, "A function call crosses semantic unit owners");
    }
    if (
      rootCallback.phase !== functionCall.phase ||
      sourceFunction?.phase !== functionCall.phase ||
      targetFunction?.phase !== functionCall.phase
    ) {
      addFailure(failures, functionCall.id, "A function call crosses React execution phases");
    }
    const hasValidFlowIndexes =
      (functionCall.kind === ReactSemanticFunctionCallKind.Direct &&
        functionCall.sourceParameterIndex === null &&
        functionCall.callArgumentIndex === null &&
        functionCall.sourcePropertyPath.length === 0) ||
      (functionCall.kind === ReactSemanticFunctionCallKind.Parameter &&
        functionCall.sourceParameterIndex !== null &&
        functionCall.callArgumentIndex === null &&
        functionCall.sourcePropertyPath.length === 0) ||
      (functionCall.kind === ReactSemanticFunctionCallKind.Captured &&
        functionCall.sourceParameterIndex === null &&
        functionCall.callArgumentIndex === null &&
        functionCall.sourcePropertyPath.length === 0) ||
      (functionCall.kind === ReactSemanticFunctionCallKind.Property &&
        functionCall.callArgumentIndex === null &&
        functionCall.sourcePropertyPath.length > 0) ||
      (functionCall.kind === ReactSemanticFunctionCallKind.SynchronousCallback &&
        functionCall.sourceParameterIndex === null &&
        functionCall.callArgumentIndex !== null &&
        functionCall.sourcePropertyPath.length === 0);
    if (!hasValidFlowIndexes) {
      addFailure(
        failures,
        functionCall.id,
        "A function call has indexes inconsistent with its flow kind",
      );
    }
    if (
      (functionCall.sourceParameterIndex !== null && functionCall.sourceParameterIndex < 0) ||
      (functionCall.callArgumentIndex !== null && functionCall.callArgumentIndex < 0)
    ) {
      addFailure(failures, functionCall.id, "A function call has a negative flow index");
    }
    if (functionCall.sourcePropertyPath.some((propertyName) => propertyName.length === 0)) {
      addFailure(failures, functionCall.id, "A function call has an empty property path segment");
    }
    if (
      !functionCall.isConditionallyReached &&
      functionCall.targetFunctionId !== rootCallback.id &&
      reachableFunctionsById.get(functionCall.targetFunctionId)?.isConditionallyReached
    ) {
      addFailure(
        failures,
        functionCall.id,
        "An unconditional function call targets a conditionally reachable function",
      );
    }
  }
  for (const eventBinding of report.graph.eventBindings) {
    if (!unitIds.has(eventBinding.ownerId)) {
      addFailure(failures, eventBinding.id, "An event binding has an unknown owner unit");
    }
    if (eventBinding.complete && eventBinding.callbackIds.length === 0) {
      addFailure(failures, eventBinding.id, "A complete event binding has no source callback");
    }
    for (const callbackId of eventBinding.callbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(failures, eventBinding.id, "An event binding has an unknown source callback");
      } else if (callback.phase !== ReactExecutionPhase.Event) {
        addFailure(failures, eventBinding.id, "An event binding source is not in the event phase");
      }
    }
  }
  for (const propFlow of report.graph.callbackPropFlows) {
    if (!unitIds.has(propFlow.renderOwnerId) || !unitIds.has(propFlow.targetOwnerId)) {
      addFailure(failures, propFlow.id, "A callback prop flow crosses an unknown semantic unit");
    }
    const render = rendersById.get(propFlow.renderId);
    if (!render) {
      addFailure(failures, propFlow.id, "A callback prop flow has an unknown render site");
    } else if (
      render.ownerId !== propFlow.renderOwnerId ||
      render.targetId !== propFlow.targetOwnerId
    ) {
      addFailure(
        failures,
        propFlow.id,
        "A callback prop flow render site has different semantic units",
      );
    }
    if (propFlow.complete && propFlow.callbackIds.length === 0) {
      addFailure(failures, propFlow.id, "A complete callback prop flow has no source callback");
    }
    if (propFlow.complete && propFlow.alternatives.length === 0) {
      addFailure(failures, propFlow.id, "A complete callback prop flow has no guarded alternative");
    }
    const alternativeCallbackIds = new Set(
      propFlow.alternatives.map((alternative) => alternative.callbackId),
    );
    if (
      propFlow.callbackIds.some((callbackId) => !alternativeCallbackIds.has(callbackId)) ||
      propFlow.alternatives.some(
        (alternative) => !propFlow.callbackIds.includes(alternative.callbackId),
      )
    ) {
      addFailure(
        failures,
        propFlow.id,
        "A callback prop flow callback set differs from its guarded alternatives",
      );
    }
    const alternativeIdentities = new Set<string>();
    for (const alternative of propFlow.alternatives) {
      const guardIds = alternative.guards.map((guard) => guard.id);
      if (new Set(guardIds).size !== guardIds.length || guardIds.some((guardId) => !guardId)) {
        addFailure(
          failures,
          propFlow.id,
          "A callback prop alternative has invalid guard identities",
        );
      }
      const alternativeIdentity = `${alternative.callbackId}:${alternative.guards
        .map((guard) => `${guard.id}=${String(guard.polarity)}`)
        .sort()
        .join("&")}`;
      if (alternativeIdentities.has(alternativeIdentity)) {
        addFailure(failures, propFlow.id, "A callback prop flow repeats a guarded alternative");
      }
      alternativeIdentities.add(alternativeIdentity);
    }
    for (const callbackId of propFlow.callbackIds) {
      const callback = callbacksById.get(callbackId);
      if (!callback) {
        addFailure(failures, propFlow.id, "A callback prop flow has an unknown source callback");
      } else if (callback.phase !== propFlow.phase) {
        addFailure(
          failures,
          propFlow.id,
          "A callback prop flow source has a mismatched execution phase",
        );
      }
    }
  }
  const eventChannelCallbackIds = new Set([
    ...report.graph.eventBindings.flatMap((eventBinding) => eventBinding.callbackIds),
    ...report.graph.callbackPropFlows
      .filter((propFlow) => propFlow.phase === ReactExecutionPhase.Event)
      .flatMap((propFlow) => propFlow.callbackIds),
  ]);
  for (const callback of report.graph.callbacks) {
    if (!unitIds.has(callback.ownerId)) {
      addFailure(failures, callback.id, "A callback has an unknown owner unit");
    }
    if (
      callback.kind === ReactSemanticCallbackKind.EventHandler &&
      !eventChannelCallbackIds.has(callback.id)
    ) {
      addFailure(failures, callback.id, "An event callback is not referenced by an event channel");
    }
  }
  for (const provider of report.graph.contextProviders) {
    if (!unitIds.has(provider.ownerId)) {
      addFailure(failures, provider.id, "A context provider has an unknown owner unit");
    }
    if (!contextIds.has(provider.contextId)) {
      addFailure(failures, provider.id, "A provider references an unknown context");
    }
  }
  for (const consumer of report.graph.contextConsumers) {
    if (!unitIds.has(consumer.ownerId)) {
      addFailure(failures, consumer.id, "A context consumer has an unknown owner unit");
    }
    if (consumer.contextId && !contextIds.has(consumer.contextId)) {
      addFailure(failures, consumer.id, "A consumer references an unknown context");
    }
    for (const providerId of consumer.sourceProviderIds) {
      if (!providerIds.has(providerId)) {
        addFailure(failures, consumer.id, "A consumer has an unknown source provider");
      }
    }
    const expectedSources = consumer.contextId
      ? (contextSourcesByUnit.get(consumer.ownerId)?.get(consumer.contextId) ?? new Set())
      : new Set<string>();
    const expectedProviderIds = [...expectedSources].filter(
      (sourceId) =>
        sourceId !== REACT_CONTEXT_DEFAULT_SOURCE_ID &&
        sourceId !== REACT_CONTEXT_UNKNOWN_SOURCE_ID,
    );
    if (
      consumer.sourceProviderIds.length !== expectedProviderIds.length ||
      expectedProviderIds.some((providerId) => !consumer.sourceProviderIds.includes(providerId))
    ) {
      addFailure(failures, consumer.id, "A context consumer has an inconsistent provider set");
    }
    const expectedUsesDefaultValue = expectedSources.has(REACT_CONTEXT_DEFAULT_SOURCE_ID);
    const expectedTopologyComplete =
      Boolean(consumer.contextId) &&
      expectedSources.size > 0 &&
      !expectedSources.has(REACT_CONTEXT_UNKNOWN_SOURCE_ID);
    if (consumer.usesDefaultValue !== expectedUsesDefaultValue) {
      addFailure(failures, consumer.id, "A context consumer has an inconsistent default source");
    }
    if (consumer.topologyComplete !== expectedTopologyComplete) {
      addFailure(
        failures,
        consumer.id,
        "A context consumer has an inconsistent topology certificate",
      );
    }
  }
  for (const form of report.graph.forms) {
    if (!unitIds.has(form.ownerId)) {
      addFailure(failures, form.id, "A form has an unknown owner unit");
    }
  }
  const formStatusHookCalls = report.graph.hookCalls.filter(
    (hookCall) => hookCall.name === "useFormStatus" && hookCall.targetId === "react:useFormStatus",
  );
  for (const formStatus of report.graph.formStatuses) {
    if (!unitIds.has(formStatus.ownerId)) {
      addFailure(failures, formStatus.id, "A Form Status consumer has an unknown owner unit");
    }
    const matchingHookCalls = formStatusHookCalls.filter(
      (hookCall) =>
        hookCall.ownerId === formStatus.ownerId &&
        areProofLocationsEqual(hookCall.location, formStatus.location),
    );
    if (matchingHookCalls.length !== 1) {
      addFailure(
        failures,
        formStatus.id,
        "A Form Status consumer does not match exactly one canonical Hook call",
      );
    }
    if (new Set(formStatus.sourceFormIds).size !== formStatus.sourceFormIds.length) {
      addFailure(failures, formStatus.id, "A Form Status consumer repeats a source form");
    }
    if (formStatus.sourceFormIds.some((formId) => !formsById.has(formId))) {
      addFailure(failures, formStatus.id, "A Form Status consumer has an unknown source form");
    }
    const expectedSources = formSourcesByUnit.get(formStatus.ownerId) ?? new Set();
    const expectedSourceFormIds = [...expectedSources].filter(
      (sourceId) =>
        sourceId !== REACT_FORM_OUTSIDE_SOURCE_ID && sourceId !== REACT_FORM_UNKNOWN_SOURCE_ID,
    );
    if (
      formStatus.sourceFormIds.length !== expectedSourceFormIds.length ||
      expectedSourceFormIds.some((formId) => !formStatus.sourceFormIds.includes(formId))
    ) {
      addFailure(
        failures,
        formStatus.id,
        "A Form Status consumer has an inconsistent parent-form source set",
      );
    }
    const expectedOutsideForm = expectedSources.has(REACT_FORM_OUTSIDE_SOURCE_ID);
    const expectedSourceComplete =
      expectedSources.size > 0 && !expectedSources.has(REACT_FORM_UNKNOWN_SOURCE_ID);
    let expectedStatus = ReactFormStatusTopologyStatus.Unknown;
    if (expectedOutsideForm) {
      expectedStatus = ReactFormStatusTopologyStatus.OutsideForm;
    } else if (expectedSourceComplete && expectedSourceFormIds.length > 0) {
      expectedStatus = ReactFormStatusTopologyStatus.Resolved;
    }
    if (formStatus.outsideForm !== expectedOutsideForm) {
      addFailure(failures, formStatus.id, "A Form Status outside-form flag is inconsistent");
    }
    if (formStatus.sourceComplete !== expectedSourceComplete) {
      addFailure(failures, formStatus.id, "A Form Status source certificate is inconsistent");
    }
    if (formStatus.status !== expectedStatus) {
      addFailure(failures, formStatus.id, "A Form Status topology status is inconsistent");
    }
    if (formStatus.complete !== (expectedStatus === ReactFormStatusTopologyStatus.Resolved)) {
      addFailure(failures, formStatus.id, "A Form Status completeness flag is inconsistent");
    }
  }
  for (const hookCall of formStatusHookCalls) {
    const matchingFormStatuses = report.graph.formStatuses.filter(
      (formStatus) =>
        formStatus.ownerId === hookCall.ownerId &&
        areProofLocationsEqual(formStatus.location, hookCall.location),
    );
    if (matchingFormStatuses.length !== 1) {
      addFailure(
        failures,
        hookCall.id,
        "A canonical useFormStatus call has no unique topology certificate",
      );
    }
  }
};

const checkSummaryAndVerdict = (
  report: ReactAppProofReport,
  failures: ReactProofCertificateFailure[],
): void => {
  const obligations = report.units.flatMap((unit) => unit.obligations);
  const proved = obligations.filter(
    (obligation) => obligation.status === ReactObligationStatus.Proved,
  ).length;
  const violated = obligations.filter(
    (obligation) => obligation.status === ReactObligationStatus.Violated,
  ).length;
  const unknown = obligations.filter(
    (obligation) => obligation.status === ReactObligationStatus.Unknown,
  ).length;
  if (
    report.summary.units !== report.units.length ||
    report.summary.proved !== proved ||
    report.summary.violated !== violated ||
    report.summary.unknown !== unknown
  ) {
    addFailure(failures, "report-summary", "The proof summary does not match its obligations");
  }
  const expectedStatus =
    violated > 0
      ? ReactAppProofStatus.Refuted
      : unknown > 0 || report.projectEvidence.length > 0
        ? ReactAppProofStatus.Incomplete
        : ReactAppProofStatus.Proved;
  if (report.status !== expectedStatus) {
    addFailure(
      failures,
      "report-status",
      `The proof facts require ${expectedStatus}, not ${report.status}`,
    );
  }
};

export const checkReactProofReport = (report: ReactAppProofReport): ReactProofCertificateCheck => {
  const failures: ReactProofCertificateFailure[] = [];
  if (report.schemaVersion !== REACT_PROOF_SCHEMA_VERSION) {
    addFailure(failures, "report-schema", "The proof report schema version is unsupported");
  }
  if (report.graph.schemaVersion !== REACT_SEMANTIC_GRAPH_SCHEMA_VERSION) {
    addFailure(failures, "graph-schema", "The semantic graph schema version is unsupported");
  }
  checkUniqueIds(
    failures,
    "units",
    report.graph.units.map((unit) => unit.id),
  );
  checkUniqueIds(
    failures,
    "Action states",
    report.graph.actionStates.map((state) => state.id),
  );
  checkUniqueIds(
    failures,
    "Action State dispatches",
    report.graph.actionStateDispatches.map((dispatch) => dispatch.id),
  );
  checkUniqueIds(
    failures,
    "schedulers",
    report.graph.schedulers.map((scheduler) => scheduler.id),
  );
  checkUniqueIds(
    failures,
    "Effect resources",
    report.graph.resources.map((resource) => resource.id),
  );
  checkUniqueIds(
    failures,
    "Class lifecycles",
    report.graph.classLifecycles.map((lifecycle) => lifecycle.id),
  );
  checkUniqueIds(
    failures,
    "Class constructions",
    report.graph.classConstructions.map((construction) => construction.id),
  );
  checkUniqueIds(
    failures,
    "Class state transitions",
    report.graph.classStateTransitions.map((transition) => transition.id),
  );
  checkUniqueIds(
    failures,
    "Hook state transitions",
    report.graph.hookStateTransitions.map((transition) => transition.id),
  );
  checkUniqueIds(
    failures,
    "reducers",
    report.graph.reducers.map((reducer) => reducer.id),
  );
  checkUniqueIds(
    failures,
    "reducer dispatches",
    report.graph.reducerDispatches.map((dispatch) => dispatch.id),
  );
  checkUniqueIds(
    failures,
    "Form Actions",
    report.graph.formActions.map((action) => action.id),
  );
  checkUniqueIds(
    failures,
    "forms",
    report.graph.forms.map((form) => form.id),
  );
  checkUniqueIds(
    failures,
    "Form Status consumers",
    report.graph.formStatuses.map((formStatus) => formStatus.id),
  );
  checkUniqueIds(
    failures,
    "Suspense boundaries",
    report.graph.suspenseBoundaries.map((boundary) => boundary.id),
  );
  checkUniqueIds(
    failures,
    "Error Boundary definitions",
    report.graph.errorBoundaryDefinitions.map((definition) => definition.id),
  );
  checkUniqueIds(
    failures,
    "Error Boundary instances",
    report.graph.errorBoundaries.map((boundary) => boundary.id),
  );
  checkUniqueIds(
    failures,
    "render failures",
    report.graph.renderFailures.map((renderFailure) => renderFailure.id),
  );
  checkUniqueIds(
    failures,
    "use resources",
    report.graph.useResources.map((resource) => resource.id),
  );
  checkUniqueIds(
    failures,
    "host controls",
    report.graph.hostControls.map((control) => control.id),
  );
  checkUniqueIds(
    failures,
    "hydration roots",
    report.graph.hydrationRoots.map((root) => root.id),
  );
  checkUniqueIds(
    failures,
    "hydration hazards",
    report.graph.hydrationHazards.map((hazard) => hazard.id),
  );
  checkUniqueIds(
    failures,
    "hydration certificates",
    report.graph.hydrations.map((hydration) => hydration.id),
  );
  checkUniqueIds(
    failures,
    "lazy components",
    report.graph.lazyComponents.map((component) => component.id),
  );
  checkUniqueIds(
    failures,
    "lazy renders",
    report.graph.lazyRenders.map((render) => render.id),
  );
  checkUniqueIds(
    failures,
    "Optimistic states",
    report.graph.optimisticStates.map((state) => state.id),
  );
  checkUniqueIds(
    failures,
    "Optimistic updates",
    report.graph.optimisticUpdates.map((update) => update.id),
  );
  checkUniqueIds(
    failures,
    "Transition Actions",
    report.graph.transitionActions.map((action) => action.id),
  );
  checkUniqueIds(
    failures,
    "Class state writes",
    report.graph.classStateWrites.map((stateWrite) => stateWrite.id),
  );
  checkUniqueIds(
    failures,
    "effects",
    report.graph.effects.map((effect) => effect.id),
  );
  checkUniqueIds(
    failures,
    "external stores",
    report.graph.externalStores.map((externalStore) => externalStore.id),
  );
  checkUniqueIds(
    failures,
    "async tasks",
    report.graph.asyncTasks.map((task) => task.id),
  );
  checkUniqueIds(
    failures,
    "callbacks",
    report.graph.callbacks.map((callback) => callback.id),
  );
  checkUniqueIds(
    failures,
    "reachable functions",
    report.graph.reachableFunctions.map((reachableFunction) => reachableFunction.id),
  );
  checkUniqueIds(
    failures,
    "function calls",
    report.graph.functionCalls.map((functionCall) => functionCall.id),
  );
  checkUniqueIds(
    failures,
    "event bindings",
    report.graph.eventBindings.map((eventBinding) => eventBinding.id),
  );
  checkUniqueIds(
    failures,
    "renders",
    report.graph.renders.map((render) => render.id),
  );
  checkUniqueIds(
    failures,
    "slot flows",
    report.graph.slotFlows.map((slotFlow) => slotFlow.id),
  );
  checkUniqueIds(
    failures,
    "callback prop flows",
    report.graph.callbackPropFlows.map((propFlow) => propFlow.id),
  );
  checkUniqueIds(
    failures,
    "callable refs",
    report.graph.callableRefs.map((callableRef) => callableRef.id),
  );
  checkUniqueIds(
    failures,
    "memo comparators",
    report.graph.memoComparators.map((comparator) => comparator.id),
  );
  checkUniqueIds(
    failures,
    "imperative handles",
    report.graph.imperativeHandles.map((handle) => handle.id),
  );
  checkUniqueIds(
    failures,
    "imperative handle methods",
    report.graph.imperativeHandleMethods.map((method) => method.id),
  );
  checkUniqueIds(
    failures,
    "imperative handle bindings",
    report.graph.imperativeHandleBindings.map((binding) => binding.id),
  );
  checkUniqueIds(
    failures,
    "imperative handle invocations",
    report.graph.imperativeHandleInvocations.map((invocation) => invocation.id),
  );
  checkUniqueIds(
    failures,
    "contexts",
    report.graph.contexts.map((context) => context.id),
  );
  checkUniqueIds(
    failures,
    "context providers",
    report.graph.contextProviders.map((provider) => provider.id),
  );
  checkUniqueIds(
    failures,
    "context consumers",
    report.graph.contextConsumers.map((consumer) => consumer.id),
  );
  checkGraphReferences(report, failures);
  checkClaimCoverage(report, failures);
  checkSummaryAndVerdict(report, failures);
  return {
    status:
      failures.length === 0
        ? ReactProofCertificateStatus.Valid
        : ReactProofCertificateStatus.Invalid,
    failures,
  };
};
