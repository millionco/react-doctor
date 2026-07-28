import { REACT_PROOF_SCHEMA_VERSION, REACT_SEMANTIC_GRAPH_SCHEMA_VERSION } from "./constants.js";
import {
  ReactAppProofStatus,
  ReactAsyncOwnershipStatus,
  ReactExecutionPhase,
  ReactObligationStatus,
  ReactProofCertificateStatus,
  ReactProofClaim,
  ReactSemanticCallbackKind,
  ReactSemanticEdgeKind,
  ReactSemanticFunctionCallKind,
  ReactUnitKind,
} from "./types.js";
import type {
  ReactAppProofReport,
  ReactProofCertificateCheck,
  ReactProofCertificateFailure,
  ReactSemanticUnit,
} from "./types.js";

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
  if (unit.kind === ReactUnitKind.ClassComponent || unit.kind === ReactUnitKind.InvalidHookOwner) {
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
  }
};

const checkGraphReferences = (
  report: ReactAppProofReport,
  failures: ReactProofCertificateFailure[],
): void => {
  const unitIds = new Set(report.graph.units.map((unit) => unit.id));
  const effectIds = new Set(report.graph.effects.map((effect) => effect.id));
  const callbackIds = new Set(report.graph.callbacks.map((callback) => callback.id));
  const callbacksById = new Map(report.graph.callbacks.map((callback) => [callback.id, callback]));
  const rendersById = new Map(report.graph.renders.map((render) => [render.id, render]));
  const reachableFunctionsById = new Map(
    report.graph.reachableFunctions.map((reachableFunction) => [
      reachableFunction.id,
      reachableFunction,
    ]),
  );
  const contextIds = new Set(report.graph.contexts.map((context) => context.id));
  const providerIds = new Set(report.graph.contextProviders.map((provider) => provider.id));

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
    const hasResolvedSource = consumer.sourceProviderIds.length > 0 || consumer.usesDefaultValue;
    if (consumer.topologyComplete !== Boolean(consumer.contextId && hasResolvedSource)) {
      addFailure(
        failures,
        consumer.id,
        "A context consumer has an inconsistent topology certificate",
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
    "callback prop flows",
    report.graph.callbackPropFlows.map((propFlow) => propFlow.id),
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
