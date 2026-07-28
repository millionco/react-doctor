import {
  REACT_CONTEXT_DEFAULT_SOURCE_ID,
  REACT_CONTEXT_UNKNOWN_SOURCE_ID,
  REACT_FORM_OUTSIDE_SOURCE_ID,
  REACT_FORM_UNKNOWN_SOURCE_ID,
  REACT_PROOF_SCHEMA_VERSION,
  REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
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
  ReactExecutionPhase,
  ReactFormActionKind,
  ReactFormActionStatus,
  ReactFormStatusTopologyStatus,
  ReactHookStateUpdaterStatus,
  ReactObligationStatus,
  ReactOptimisticActionStatus,
  ReactOptimisticReducerStatus,
  ReactProofCertificateStatus,
  ReactProofClaim,
  ReactSchedulerCancellationStatus,
  ReactSemanticCallbackKind,
  ReactSemanticEdgeKind,
  ReactSemanticFunctionCallKind,
  ReactSemanticRenderKind,
  ReactTransitionActionStatus,
  ReactTransitionStarterKind,
  ReactUnitKind,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import type {
  ReactAppProofReport,
  ReactProofCertificateCheck,
  ReactProofCertificateFailure,
  ReactSemanticUnit,
} from "./types.js";

const HOOK_STATE_UPDATER_STATUSES = new Set(Object.values(ReactHookStateUpdaterStatus));
const ACTION_STATE_DISPATCH_STATUSES = new Set(Object.values(ReactActionStateDispatchStatus));
const ACTION_STATE_DISPATCH_KINDS = new Set(Object.values(ReactActionStateDispatchKind));
const ACTION_STATE_REDUCER_STATUSES = new Set(Object.values(ReactActionStateReducerStatus));
const FORM_ACTION_KINDS = new Set(Object.values(ReactFormActionKind));
const FORM_ACTION_STATUSES = new Set(Object.values(ReactFormActionStatus));
const OPTIMISTIC_ACTION_STATUSES = new Set(Object.values(ReactOptimisticActionStatus));
const OPTIMISTIC_REDUCER_STATUSES = new Set(Object.values(ReactOptimisticReducerStatus));
const TRANSITION_ACTION_STATUSES = new Set(Object.values(ReactTransitionActionStatus));
const TRANSITION_STARTER_KINDS = new Set(Object.values(ReactTransitionStarterKind));
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
