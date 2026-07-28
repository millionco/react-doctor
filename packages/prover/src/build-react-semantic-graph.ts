import ts from "typescript";
import { collectAsyncEffectTaskDescriptors } from "./collect-async-effect-task-descriptors.js";
import { collectClassConstruction } from "./collect-class-construction.js";
import { collectClassStateTransitions } from "./collect-class-state-transitions.js";
import { collectClassStateWrites } from "./collect-class-state-writes.js";
import type { ClassStateWriteRootDescriptor } from "./collect-class-state-writes.js";
import { collectCallableRefProtocols } from "./collect-callable-ref-protocols.js";
import { collectCallbackStateWrites } from "./collect-callback-state-writes.js";
import { createComponentCallbackFlow } from "./create-component-callback-flow.js";
import type {
  ComponentCallbackDescriptor,
  ComponentCallbackFlowDescriptor,
} from "./create-component-callback-flow.js";
import { collectDirectHookCalls } from "./collect-direct-hook-calls.js";
import { collectEffectEventBindings } from "./collect-effect-event-bindings.js";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import {
  collectEffectSchedulerProtocols,
  collectLifecycleSchedulerProtocols,
} from "./collect-effect-scheduler-protocols.js";
import {
  collectEffectResourceProtocols,
  collectLifecycleResourceProtocols,
} from "./collect-effect-resource-protocols.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectHookCalls } from "./collect-hook-calls.js";
import { collectReactiveCaptures } from "./collect-reactive-captures.js";
import { collectReachableFunctionGraph } from "./collect-reachable-functions.js";
import {
  REACT_EXTERNAL_STORE_HOOK_NAMES,
  REACT_MEMO_HOOK_NAMES,
  REACT_REDUCER_HOOK_NAMES,
  REACT_CONTEXT_DEFAULT_SOURCE_ID,
  REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
} from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getFunctionName } from "./get-function-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { extractReactCompilerGraph } from "./extract-react-compiler-graph.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isReactContextExpression } from "./is-react-context-expression.js";
import { resolveFunction } from "./resolve-function.js";
import { mergeCallableBindings } from "./resolve-callable-expression.js";
import type { ResolvedCallableValueDescriptor } from "./resolve-callable-expression.js";
import {
  ReactCallableRefFreshness,
  ReactClassConstructionIssueStatus,
  ReactClassConstructionStatus,
  ReactClassStateUpdaterStatus,
  ReactClassStateWriteStatus,
  ReactClassUpdateCycleStatus,
  ReactEffectDependencyMode,
  ReactExecutionPhase,
  ReactIdentityStability,
  ReactSemanticCallbackKind,
  ReactSemanticEdgeKind,
  ReactUnitKind,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactSemanticCallback,
  ReactSemanticAsyncTask,
  ReactSemanticContext,
  ReactSemanticContextConsumer,
  ReactSemanticContextProvider,
  ReactSemanticEdge,
  ReactSemanticEffect,
  ReactSemanticEffectEvent,
  ReactSemanticEventBinding,
  ReactSemanticCallbackPropAlternative,
  ReactSemanticCallbackPropFlow,
  ReactSemanticCallableRef,
  ReactSemanticClassConstruction,
  ReactSemanticClassLifecycle,
  ReactSemanticClassStateWrite,
  ReactSemanticClassStateTransition,
  ReactSemanticExternalStore,
  ReactSemanticFunctionCall,
  ReactSemanticGraph,
  ReactSemanticHookCall,
  ReactSemanticReachableFunction,
  ReactSemanticRender,
  ReactSemanticEffectResource,
  ReactSemanticScheduler,
  ReactSemanticUnit,
  ReactUnitDescriptor,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import { getClassMethodDeclaration } from "./utils/get-class-method-declaration.js";
import { isDeferredCallbackSynchronous } from "./utils/is-deferred-callback-synchronous.js";

interface UnitGraphIdentity {
  descriptor: ReactUnitDescriptor;
  semanticUnit: ReactSemanticUnit;
}

interface EffectGraphFacts {
  effects: ReadonlyArray<ReactSemanticEffect>;
  schedulers: ReadonlyArray<ReactSemanticScheduler>;
  resources: ReadonlyArray<ReactSemanticEffectResource>;
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
}

interface ClassLifecycleGraphFacts {
  construction: ReactSemanticClassConstruction | null;
  lifecycle: ReactSemanticClassLifecycle | null;
  stateWrites: ReadonlyArray<ReactSemanticClassStateWrite>;
  transitions: ReadonlyArray<ReactSemanticClassStateTransition>;
  schedulers: ReadonlyArray<ReactSemanticScheduler>;
  resources: ReadonlyArray<ReactSemanticEffectResource>;
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
}

interface EffectEventGraphFacts {
  effectEvents: ReadonlyArray<ReactSemanticEffectEvent>;
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
}

interface ExternalStoreGraphFacts {
  externalStores: ReadonlyArray<ReactSemanticExternalStore>;
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
}

interface ExternalStoreCallbackFacts extends CallbackGraphFacts {
  callbackIds: ReadonlyArray<string>;
  isComplete: boolean;
}

interface ExternalStoreCallbackDescriptor {
  kind: ReactSemanticCallbackKind;
  name: string;
  phase: ReactExecutionPhase;
}

interface CallbackGraphFacts {
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
}

interface EventGraphFacts extends CallbackGraphFacts {
  eventBindings: ReadonlyArray<ReactSemanticEventBinding>;
}

interface CallbackPropGraphFacts extends CallbackGraphFacts {
  callbackPropFlows: ReadonlyArray<ReactSemanticCallbackPropFlow>;
}

interface CallbackPropReachabilityDescriptor {
  callbackDescriptor: ComponentCallbackDescriptor;
  callbackFact: ReactSemanticCallback;
  identity: UnitGraphIdentity;
}

interface ReachabilityGraphFacts {
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>;
}

interface ReducerCallbackDescriptor {
  argumentIndex: number;
  kind: ReactSemanticCallbackKind;
  name: string;
}

interface ContextDefinitionIdentity {
  context: ReactSemanticContext;
  symbol: ts.Symbol;
}

interface ContextProviderIdentity {
  provider: ReactSemanticContextProvider;
  openingNode: ts.JsxOpeningLikeElement;
}

interface ContextGraphFacts {
  contexts: ReadonlyArray<ReactSemanticContext>;
  contextProviders: ReadonlyArray<ReactSemanticContextProvider>;
  contextConsumers: ReadonlyArray<ReactSemanticContextConsumer>;
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>;
  contextIdsBySymbol: ReadonlyMap<ts.Symbol, string>;
}

const collectCallableRefGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  callbacks: ReadonlyArray<ReactSemanticCallback>,
  functionCalls: ReadonlyArray<ReactSemanticFunctionCall>,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactSemanticCallableRef> => {
  const callbacksById = new Map(callbacks.map((callback) => [callback.id, callback]));
  return identities.flatMap((identity) => {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) return [];
    return collectCallableRefProtocols(functionNode, context.typeChecker).map((protocol) => {
      const invocationLocations = protocol.invocationExpressions.map((invocationExpression) =>
        getNodeLocation(invocationExpression, context.rootDirectory),
      );
      const invocationCalls = functionCalls.filter(
        (functionCall) =>
          invocationLocations.some((location) =>
            areProofLocationsEqual(location, functionCall.location),
          ) &&
          callbacksById.get(functionCall.rootCallbackId)?.kind !==
            ReactSemanticCallbackKind.MemoizedCallback,
      );
      const invocationCallbackIds = [
        ...new Set(invocationCalls.map((functionCall) => functionCall.rootCallbackId)),
      ];
      const invocationCallbacks = invocationCallbackIds.flatMap((callbackId) => {
        const callback = callbacksById.get(callbackId);
        return callback ? [callback] : [];
      });
      const isEventSynchronized =
        protocol.isSourceComplete &&
        protocol.updateHookName === "useLayoutEffect" &&
        invocationCallbacks.length > 0 &&
        invocationCallbacks.every((callback) => callback.phase === ReactExecutionPhase.Event);
      const freshness = isEventSynchronized
        ? ReactCallableRefFreshness.EventSynchronized
        : protocol.updateHookName === "useEffect"
          ? ReactCallableRefFreshness.PassiveLag
          : ReactCallableRefFreshness.Unknown;
      return {
        id: createSemanticId("callable-ref", protocol.refName, protocol.declaration, context),
        ownerId: identity.semanticUnit.id,
        name: protocol.refName,
        location: getNodeLocation(protocol.declaration, context.rootDirectory),
        updateHookName: protocol.updateHookName,
        updateLocation: protocol.updateHookCall
          ? getNodeLocation(protocol.updateHookCall, context.rootDirectory)
          : null,
        invocationCallIds: invocationCalls.map((functionCall) => functionCall.id),
        invocationCallbackIds,
        invocationLocations,
        freshness,
        sourceComplete: protocol.isSourceComplete,
        complete: isEventSynchronized,
      };
    });
  });
};

interface RenderGraphFacts {
  edges: ReadonlyArray<ReactSemanticEdge>;
  renders: ReadonlyArray<ReactSemanticRender>;
}

const createSemanticId = (
  kind: string,
  name: string,
  node: ts.Node,
  context: ReactAnalysisContext,
): string => {
  const location = getNodeLocation(node, context.rootDirectory);
  return `${location.filePath}:${location.line}:${location.column}:${kind}:${name}`;
};

const getDeclarationNameNode = (descriptor: ReactUnitDescriptor): ts.Node | null => {
  if (descriptor.classNode) return descriptor.classNode.name ?? descriptor.classNode;
  const functionNode = descriptor.functionNode;
  if (!functionNode) return descriptor.node;
  if (functionNode.name) return functionNode.name;
  if (ts.isVariableDeclaration(functionNode.parent)) return functionNode.parent.name;
  if (ts.isPropertyAssignment(functionNode.parent)) return functionNode.parent.name;
  return functionNode;
};

const resolveAliasedSymbol = (symbol: ts.Symbol, typeChecker: ts.TypeChecker): ts.Symbol =>
  symbol.flags & ts.SymbolFlags.Alias ? typeChecker.getAliasedSymbol(symbol) : symbol;

const getExpressionSymbol = (
  expression: ts.Expression | ts.JsxTagNameExpression,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  const symbol = typeChecker.getSymbolAtLocation(expression);
  return symbol ? resolveAliasedSymbol(symbol, typeChecker) : null;
};

const collectContextDefinitions = (
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  context: ReactAnalysisContext,
): ReadonlyArray<ContextDefinitionIdentity> => {
  const definitions: ContextDefinitionIdentity[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      getCanonicalReactApiName(node.initializer.expression, context.typeChecker) === "createContext"
    ) {
      const symbol = context.typeChecker.getSymbolAtLocation(node.name);
      if (symbol) {
        definitions.push({
          context: {
            id: createSemanticId("context", node.name.text, node, context),
            name: node.name.text,
            location: getNodeLocation(node, context.rootDirectory),
            defaultValueText: node.initializer.arguments[0]?.getText() ?? "undefined",
          },
          symbol: resolveAliasedSymbol(symbol, context.typeChecker),
        });
      }
    }
    node.forEachChild(visit);
  };
  for (const sourceFile of sourceFiles) sourceFile.forEachChild(visit);
  return definitions;
};

const getContextIdFromExpression = (
  expression: ts.Expression,
  contextIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  typeChecker: ts.TypeChecker,
): string | null => {
  const symbol = getExpressionSymbol(expression, typeChecker);
  return symbol ? (contextIdsBySymbol.get(symbol) ?? null) : null;
};

const getProviderContextId = (
  tagName: ts.JsxTagNameExpression,
  contextIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  typeChecker: ts.TypeChecker,
): string | null => {
  if (ts.isIdentifier(tagName)) {
    return getContextIdFromExpression(tagName, contextIdsBySymbol, typeChecker);
  }
  if (ts.isPropertyAccessExpression(tagName) && tagName.name.text === "Provider") {
    return getContextIdFromExpression(tagName.expression, contextIdsBySymbol, typeChecker);
  }
  return null;
};

const getProviderValue = (
  openingNode: ts.JsxOpeningLikeElement,
): { valueProvided: boolean; valueText: string | null } => {
  const valueAttribute = openingNode.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === "value",
  );
  if (!valueAttribute) return { valueProvided: false, valueText: null };
  if (!valueAttribute.initializer) return { valueProvided: true, valueText: "true" };
  if (ts.isJsxExpression(valueAttribute.initializer) && valueAttribute.initializer.expression) {
    return { valueProvided: true, valueText: valueAttribute.initializer.expression.getText() };
  }
  return { valueProvided: true, valueText: valueAttribute.initializer.getText() };
};

const collectContextGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  context: ReactAnalysisContext,
): ContextGraphFacts => {
  const definitions = collectContextDefinitions(sourceFiles, context);
  const contextIdsBySymbol = new Map(
    definitions.map((definition) => [definition.symbol, definition.context.id]),
  );
  const providerIdentities: ContextProviderIdentity[] = [];
  const contextConsumers: ReactSemanticContextConsumer[] = [];

  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const visit = (node: ts.Node): void => {
      if (node !== functionNode && isFunctionBoundary(node)) return;
      const openingNode = ts.isJsxOpeningElement(node)
        ? node
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null;
      if (openingNode) {
        const contextId = getProviderContextId(
          openingNode.tagName,
          contextIdsBySymbol,
          context.typeChecker,
        );
        if (contextId) {
          const providerValue = getProviderValue(openingNode);
          providerIdentities.push({
            openingNode,
            provider: {
              id: createSemanticId("context-provider", contextId, openingNode, context),
              ownerId: identity.semanticUnit.id,
              contextId,
              location: getNodeLocation(openingNode, context.rootDirectory),
              ...providerValue,
            },
          });
        }
      }
      if (ts.isCallExpression(node)) {
        const hookName = getCanonicalReactApiName(node.expression, context.typeChecker);
        const contextExpression = node.arguments[0];
        if (
          hookName === "useContext" ||
          (hookName === "use" &&
            contextExpression &&
            isReactContextExpression(contextExpression, context.typeChecker))
        ) {
          contextConsumers.push({
            id: createSemanticId("context-consumer", hookName, node, context),
            ownerId: identity.semanticUnit.id,
            contextId: contextExpression
              ? getContextIdFromExpression(
                  contextExpression,
                  contextIdsBySymbol,
                  context.typeChecker,
                )
              : null,
            hookName,
            location: getNodeLocation(node, context.rootDirectory),
            sourceProviderIds: [],
            usesDefaultValue: false,
            topologyComplete: false,
          });
        }
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }

  return {
    contexts: definitions.map((definition) => definition.context),
    contextProviders: providerIdentities.map((identity) => identity.provider),
    contextConsumers,
    providersByOpeningNode: new Map(
      providerIdentities.map((identity) => [identity.openingNode, identity.provider]),
    ),
    contextIdsBySymbol,
  };
};

const collectActiveContextProviderIds = (
  node: ts.Node,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
): ReadonlyArray<string> => {
  const providerIds: string[] = [];
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode) {
    if (ts.isJsxElement(currentNode)) {
      const provider = providersByOpeningNode.get(currentNode.openingElement);
      if (provider) providerIds.unshift(provider.id);
    }
    currentNode = currentNode.parent;
  }
  return providerIds;
};

const collectUnitIdentitiesBySymbol = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  context: ReactAnalysisContext,
): ReadonlyMap<ts.Symbol, UnitGraphIdentity> => {
  const unitIdentitiesBySymbol = new Map<ts.Symbol, UnitGraphIdentity>();
  for (const identity of identities) {
    const declarationName = getDeclarationNameNode(identity.descriptor);
    if (!declarationName) continue;
    const symbol = context.typeChecker.getSymbolAtLocation(declarationName);
    if (symbol)
      unitIdentitiesBySymbol.set(resolveAliasedSymbol(symbol, context.typeChecker), identity);
  }
  return unitIdentitiesBySymbol;
};

const resolveUnitTarget = (
  expression: ts.Expression | ts.JsxTagNameExpression,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  typeChecker: ts.TypeChecker,
): string | null => {
  const symbol = getExpressionSymbol(expression, typeChecker);
  return symbol ? (unitIdsBySymbol.get(symbol) ?? null) : null;
};

const collectRenderEdges = (
  identity: UnitGraphIdentity,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
  context: ReactAnalysisContext,
): RenderGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode) return { edges: [], renders: [] };
  const edges: ReactSemanticEdge[] = [];
  const renders: ReactSemanticRender[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      return;
    }
    const tagName = ts.isJsxOpeningElement(node)
      ? node.tagName
      : ts.isJsxSelfClosingElement(node)
        ? node.tagName
        : null;
    if (tagName && ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
      const targetId = resolveUnitTarget(tagName, unitIdsBySymbol, context.typeChecker);
      if (targetId) {
        const location = getNodeLocation(tagName, context.rootDirectory);
        edges.push({
          kind: ReactSemanticEdgeKind.RendersComponent,
          sourceId: identity.semanticUnit.id,
          targetId,
          location,
        });
        renders.push({
          id: createSemanticId("render", targetId, tagName, context),
          ownerId: identity.semanticUnit.id,
          targetId,
          location,
          activeContextProviderIds: collectActiveContextProviderIds(
            tagName,
            providersByOpeningNode,
          ),
        });
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return { edges, renders };
};

const collectHookGraph = (
  identity: UnitGraphIdentity,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  context: ReactAnalysisContext,
): { hookCalls: ReadonlyArray<ReactSemanticHookCall>; edges: ReadonlyArray<ReactSemanticEdge> } => {
  const ownerNode = identity.descriptor.functionNode ?? identity.descriptor.node;
  const hookCalls: ReactSemanticHookCall[] = [];
  const edges: ReactSemanticEdge[] = [];
  for (const hookCall of collectDirectHookCalls(ownerNode, context.typeChecker)) {
    const hookName = getCanonicalHookName(hookCall, context.typeChecker) ?? "unknown-hook";
    const targetId =
      resolveUnitTarget(hookCall.expression, unitIdsBySymbol, context.typeChecker) ??
      `react:${hookName}`;
    const location = getNodeLocation(hookCall, context.rootDirectory);
    hookCalls.push({
      id: createSemanticId("hook-call", hookName, hookCall, context),
      ownerId: identity.semanticUnit.id,
      name: hookName,
      targetId,
      location,
    });
    edges.push({
      kind: ReactSemanticEdgeKind.CallsHook,
      sourceId: identity.semanticUnit.id,
      targetId,
      location,
    });
  }
  return { hookCalls, edges };
};

const getEffectDependencyFacts = (
  effectCall: ts.CallExpression,
): { mode: ReactEffectDependencyMode; dependencies: ReadonlyArray<string> } => {
  const dependencyExpression = effectCall.arguments[1];
  if (!dependencyExpression) {
    return { mode: ReactEffectDependencyMode.Missing, dependencies: [] };
  }
  if (!ts.isArrayLiteralExpression(dependencyExpression)) {
    return { mode: ReactEffectDependencyMode.Opaque, dependencies: [] };
  }
  return {
    mode: ReactEffectDependencyMode.Inline,
    dependencies: dependencyExpression.elements.map((dependency) => dependency.getText()),
  };
};

const createCallbackFact = (
  identity: UnitGraphIdentity,
  callback: ts.FunctionLikeDeclaration,
  owner: ts.FunctionLikeDeclaration,
  stableSymbols: ReadonlySet<ts.Symbol>,
  kind: ReactSemanticCallbackKind,
  phase: ReactExecutionPhase,
  name: string,
  context: ReactAnalysisContext,
): ReactSemanticCallback => ({
  id: createSemanticId(`${kind}:${identity.semanticUnit.id}`, name, callback, context),
  ownerId: identity.semanticUnit.id,
  kind,
  phase,
  name,
  location: getNodeLocation(callback, context.rootDirectory),
  captures: collectReactiveCaptures(callback, owner, context.typeChecker, stableSymbols).map(
    (capture) => capture.key,
  ),
  stateWrites: collectCallbackStateWrites(callback, owner, context.typeChecker),
});

const createCallbackPropAlternative = (
  callbackId: string,
  callbackDescriptor: ComponentCallbackDescriptor,
  context: ReactAnalysisContext,
): ReactSemanticCallbackPropAlternative => ({
  callbackId,
  guards: callbackDescriptor.guards.map((guard) => ({
    id: createSemanticId("callback-guard", "condition", guard.conditionNode, context),
    polarity: guard.polarity,
  })),
});

const collectReachabilityGraphFacts = (
  identity: UnitGraphIdentity,
  rootFunction: ts.FunctionLikeDeclaration,
  rootCallback: ReactSemanticCallback,
  context: ReactAnalysisContext,
  initialBindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor> = new Map(),
): ReachabilityGraphFacts => {
  const reachabilityGraph = collectReachableFunctionGraph(
    rootFunction,
    context.typeChecker,
    initialBindings,
  );
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionIdsByNode = new Map<ts.FunctionLikeDeclaration, string>([
    [rootFunction, rootCallback.id],
  ]);
  for (const descriptor of reachabilityGraph.functions) {
    if (descriptor.functionNode === rootFunction) continue;
    const functionName = getFunctionName(descriptor.functionNode) ?? "anonymous helper";
    const reachableFunction: ReactSemanticReachableFunction = {
      id: createSemanticId(
        `reachable-function:${rootCallback.id}`,
        functionName,
        descriptor.functionNode,
        context,
      ),
      ownerId: identity.semanticUnit.id,
      rootCallbackId: rootCallback.id,
      name: functionName,
      phase: rootCallback.phase,
      location: getNodeLocation(descriptor.functionNode, context.rootDirectory),
      isConditionallyReached: descriptor.isConditionallyReached,
    };
    reachableFunctions.push(reachableFunction);
    functionIdsByNode.set(descriptor.functionNode, reachableFunction.id);
  }
  const functionCalls = reachabilityGraph.calls.flatMap(
    (functionCall): ReadonlyArray<ReactSemanticFunctionCall> => {
      const sourceFunctionId = functionIdsByNode.get(functionCall.sourceFunctionNode);
      const targetFunctionId = functionIdsByNode.get(functionCall.targetFunctionNode);
      if (!sourceFunctionId || !targetFunctionId) return [];
      return [
        {
          id: createSemanticId(
            `function-call:${rootCallback.id}:${sourceFunctionId}:${targetFunctionId}`,
            functionCall.kind,
            functionCall.callExpression,
            context,
          ),
          ownerId: identity.semanticUnit.id,
          rootCallbackId: rootCallback.id,
          sourceFunctionId,
          targetFunctionId,
          kind: functionCall.kind,
          phase: rootCallback.phase,
          location: getNodeLocation(functionCall.callExpression, context.rootDirectory),
          sourceParameterIndex: functionCall.sourceParameterIndex,
          callArgumentIndex: functionCall.callArgumentIndex,
          sourcePropertyPath: functionCall.sourcePropertyPath,
          isConditionallyReached: functionCall.isConditionallyReached,
        },
      ];
    },
  );
  return { reachableFunctions, functionCalls };
};

const collectEffectGraph = (
  identity: UnitGraphIdentity,
  identitiesByFunction: ReadonlyMap<ts.FunctionLikeDeclaration, UnitGraphIdentity>,
  context: ReactAnalysisContext,
  componentFlow: ComponentCallbackFlowDescriptor,
): EffectGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode || identity.descriptor.kind === ReactUnitKind.InvalidHookOwner) {
    return {
      effects: [],
      schedulers: [],
      resources: [],
      callbacks: [],
      reachableFunctions: [],
      functionCalls: [],
    };
  }
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([
    ...hookBindings.effectEvents,
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
  ]);
  const effects: ReactSemanticEffect[] = [];
  const schedulers: ReactSemanticScheduler[] = [];
  const resources: ReactSemanticEffectResource[] = [];
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const semanticOwnerId = identity.semanticUnit.id;
  const schedulerProtocols = collectEffectSchedulerProtocols(functionNode, context);
  const resourceProtocols = collectEffectResourceProtocols(functionNode, context);
  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const hookName = getCanonicalHookName(effectCall, context.typeChecker) ?? "unknown-effect";
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    const dependencyFacts = getEffectDependencyFacts(effectCall);
    const captures = effectCallback
      ? collectReactiveCaptures(
          effectCallback,
          functionNode,
          context.typeChecker,
          stableSymbols,
        ).map((capture) => capture.key)
      : [];
    const cleanupFunctions = effectCallback
      ? collectEffectCleanupFunctions(effectCallback, context.typeChecker)
      : [];
    const setupCallback = effectCallback
      ? createCallbackFact(
          identity,
          effectCallback,
          functionNode,
          stableSymbols,
          ReactSemanticCallbackKind.EffectSetup,
          ReactExecutionPhase.EffectSetup,
          hookName,
          context,
        )
      : null;
    const cleanupCallbacks = cleanupFunctions.map((cleanupFunction) =>
      createCallbackFact(
        identity,
        cleanupFunction,
        functionNode,
        stableSymbols,
        ReactSemanticCallbackKind.EffectCleanup,
        ReactExecutionPhase.EffectCleanup,
        hookName,
        context,
      ),
    );
    if (setupCallback) callbacks.push(setupCallback);
    callbacks.push(...cleanupCallbacks);
    if (effectCallback && setupCallback) {
      const callbackResolution = componentFlow.resolveCallback(
        effectCallback,
        functionNode,
        ReactExecutionPhase.EffectSetup,
      );
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        effectCallback,
        setupCallback,
        context,
        callbackResolution.bindings,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    for (const [cleanupIndex, cleanupFunction] of cleanupFunctions.entries()) {
      const cleanupCallback = cleanupCallbacks[cleanupIndex];
      if (cleanupCallback) {
        const callbackResolution = componentFlow.resolveCallback(
          cleanupFunction,
          functionNode,
          ReactExecutionPhase.EffectCleanup,
        );
        const reachabilityFacts = collectReachabilityGraphFacts(
          identity,
          cleanupFunction,
          cleanupCallback,
          context,
          callbackResolution.bindings,
        );
        reachableFunctions.push(...reachabilityFacts.reachableFunctions);
        functionCalls.push(...reachabilityFacts.functionCalls);
      }
    }
    const effectFact: ReactSemanticEffect = {
      id: createSemanticId("effect", hookName, effectCall, context),
      ownerId: semanticOwnerId,
      hookName,
      location: getNodeLocation(effectCall, context.rootDirectory),
      callbackResolved: Boolean(effectCallback),
      dependencyMode: dependencyFacts.mode,
      dependencies: dependencyFacts.dependencies,
      captures,
      hasCleanup: cleanupFunctions.length > 0,
      setupCallbackId: setupCallback?.id ?? null,
      cleanupCallbackIds: cleanupCallbacks.map((callback) => callback.id),
    };
    effects.push(effectFact);
    for (const protocol of schedulerProtocols.filter(
      (candidate) => candidate.effectCall === effectCall,
    )) {
      const schedulerId = createSemanticId(
        "scheduler",
        protocol.kind,
        protocol.registrationCall,
        context,
      );
      const callbackResolution = protocol.callbackExpression
        ? componentFlow.resolveExpression(
            protocol.callbackExpression,
            functionNode,
            ReactExecutionPhase.Deferred,
          )
        : null;
      const schedulerCallbacks = (callbackResolution?.callbacks ?? []).map((callbackDescriptor) => {
        const callbackOwner =
          identitiesByFunction.get(callbackDescriptor.ownerFunction) ?? identity;
        const callbackHookBindings = collectHookBindings(
          callbackDescriptor.ownerFunction,
          context.typeChecker,
        );
        const callbackFact = createCallbackFact(
          callbackOwner,
          callbackDescriptor.callbackFunction,
          callbackDescriptor.ownerFunction,
          new Set([...callbackHookBindings.refs, ...callbackHookBindings.stateSetters]),
          ReactSemanticCallbackKind.ScheduledCallback,
          ReactExecutionPhase.Deferred,
          protocol.kind,
          context,
        );
        return {
          ...callbackFact,
          id: createSemanticId(
            `scheduled-callback:${schedulerId}`,
            protocol.kind,
            callbackDescriptor.callbackFunction,
            context,
          ),
        };
      });
      callbacks.push(...schedulerCallbacks);
      for (const [callbackIndex, callbackDescriptor] of (
        callbackResolution?.callbacks ?? []
      ).entries()) {
        const callbackFact = schedulerCallbacks[callbackIndex];
        if (!callbackFact) continue;
        const callbackOwner =
          identitiesByFunction.get(callbackDescriptor.ownerFunction) ?? identity;
        const reachabilityFacts = collectReachabilityGraphFacts(
          callbackOwner,
          callbackDescriptor.callbackFunction,
          callbackFact,
          context,
          callbackDescriptor.bindings,
        );
        reachableFunctions.push(...reachabilityFacts.reachableFunctions);
        functionCalls.push(...reachabilityFacts.functionCalls);
      }
      const callbackComplete = Boolean(
        callbackResolution?.isComplete &&
        schedulerCallbacks.length > 0 &&
        callbackResolution.callbacks.every((callbackDescriptor) =>
          isDeferredCallbackSynchronous(callbackDescriptor.callbackFunction, context),
        ),
      );
      schedulers.push({
        id: schedulerId,
        ownerId: semanticOwnerId,
        effectId: effectFact.id,
        registrationCallbackId: effectFact.setupCallbackId ?? "",
        kind: protocol.kind,
        phase: ReactExecutionPhase.Deferred,
        location: getNodeLocation(protocol.registrationCall, context.rootDirectory),
        callbackIds: schedulerCallbacks.map((callback) => callback.id),
        callbackComplete,
        cancellationStatus: protocol.cancellationStatus,
        cancellationLocations: protocol.cancellationCalls.map((cancellationCall) =>
          getNodeLocation(cancellationCall, context.rootDirectory),
        ),
        sourceComplete: protocol.isSourceComplete,
        complete:
          protocol.isSourceComplete && callbackComplete && Boolean(effectFact.setupCallbackId),
      });
    }
    for (const protocol of resourceProtocols.filter(
      (candidate) => candidate.effectCall === effectCall,
    )) {
      const resourceId = createSemanticId(
        "effect-resource",
        protocol.kind,
        protocol.acquisitionNode,
        context,
      );
      const callbackResolution = protocol.callbackExpression
        ? componentFlow.resolveExpression(
            protocol.callbackExpression,
            functionNode,
            ReactExecutionPhase.Deferred,
          )
        : null;
      const effectEventBinding =
        protocol.callbackExpression && ts.isIdentifier(protocol.callbackExpression)
          ? collectEffectEventBindings(functionNode, context.typeChecker).find(
              (binding) =>
                context.typeChecker.getSymbolAtLocation(
                  protocol.callbackExpression ?? effectCall,
                ) === binding.symbol,
            )
          : null;
      const directCallback =
        protocol.callbackExpression &&
        (resolveFunction(protocol.callbackExpression, context.typeChecker) ??
          effectEventBinding?.callback);
      let callbackDescriptors: ReadonlyArray<ComponentCallbackDescriptor> = [];
      if (!effectEventBinding && callbackResolution?.callbacks.length) {
        callbackDescriptors = callbackResolution.callbacks;
      } else if (!effectEventBinding && directCallback) {
        callbackDescriptors = [
          {
            bindings: new Map(),
            callbackFunction: directCallback,
            guards: [],
            ownerFunction: functionNode,
          },
        ];
      }
      const resourceCallbacks = callbackDescriptors.map((callbackDescriptor) => {
        const callbackOwner =
          identitiesByFunction.get(callbackDescriptor.ownerFunction) ?? identity;
        const callbackHookBindings = collectHookBindings(
          callbackDescriptor.ownerFunction,
          context.typeChecker,
        );
        const callbackFact = createCallbackFact(
          callbackOwner,
          callbackDescriptor.callbackFunction,
          callbackDescriptor.ownerFunction,
          new Set([...callbackHookBindings.refs, ...callbackHookBindings.stateSetters]),
          ReactSemanticCallbackKind.ResourceCallback,
          ReactExecutionPhase.Deferred,
          protocol.kind,
          context,
        );
        return {
          ...callbackFact,
          id: createSemanticId(
            `resource-callback:${resourceId}`,
            protocol.kind,
            callbackDescriptor.callbackFunction,
            context,
          ),
        };
      });
      callbacks.push(...resourceCallbacks);
      for (const [callbackIndex, callbackDescriptor] of callbackDescriptors.entries()) {
        const callbackFact = resourceCallbacks[callbackIndex];
        if (!callbackFact) continue;
        const callbackOwner =
          identitiesByFunction.get(callbackDescriptor.ownerFunction) ?? identity;
        const reachabilityFacts = collectReachabilityGraphFacts(
          callbackOwner,
          callbackDescriptor.callbackFunction,
          callbackFact,
          context,
          callbackDescriptor.bindings,
        );
        reachableFunctions.push(...reachabilityFacts.reachableFunctions);
        functionCalls.push(...reachabilityFacts.functionCalls);
      }
      const effectEventCallback =
        effectEventBinding?.callback &&
        createCallbackFact(
          identity,
          effectEventBinding.callback,
          functionNode,
          stableSymbols,
          ReactSemanticCallbackKind.EffectEvent,
          ReactExecutionPhase.EffectEvent,
          effectEventBinding.name,
          context,
        );
      const callbackIds = effectEventCallback
        ? [effectEventCallback.id]
        : resourceCallbacks.map((callback) => callback.id);
      const callbackComplete = effectEventBinding?.callback
        ? isDeferredCallbackSynchronous(effectEventBinding.callback, context)
        : Boolean(
            (callbackResolution?.isComplete || directCallback) &&
            resourceCallbacks.length > 0 &&
            callbackDescriptors.every((callbackDescriptor) =>
              isDeferredCallbackSynchronous(callbackDescriptor.callbackFunction, context),
            ),
          );
      resources.push({
        id: resourceId,
        ownerId: semanticOwnerId,
        effectId: effectFact.id,
        acquisitionCallbackId: effectFact.setupCallbackId ?? "",
        kind: protocol.kind,
        phase: ReactExecutionPhase.Deferred,
        location: getNodeLocation(protocol.acquisitionNode, context.rootDirectory),
        activationLocations: protocol.acquisitionNodes.map((acquisitionNode) =>
          getNodeLocation(acquisitionNode, context.rootDirectory),
        ),
        callbackIds,
        callbackComplete,
        disposalStatus: protocol.disposalStatus,
        disposalLocations: protocol.disposalCalls.map((disposalCall) =>
          getNodeLocation(disposalCall, context.rootDirectory),
        ),
        sourceComplete: protocol.isSourceComplete,
        complete:
          protocol.isSourceComplete && callbackComplete && Boolean(effectFact.setupCallbackId),
      });
    }
  }
  return { effects, schedulers, resources, callbacks, reachableFunctions, functionCalls };
};

const collectClassLifecycleGraph = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): ClassLifecycleGraphFacts => {
  const classNode = identity.descriptor.classNode;
  const renderMethod = classNode ? getClassMethodDeclaration(classNode, "render") : null;
  if (identity.descriptor.kind !== ReactUnitKind.ClassComponent || !classNode || !renderMethod) {
    return {
      construction: null,
      lifecycle: null,
      stateWrites: [],
      transitions: [],
      schedulers: [],
      resources: [],
      callbacks: [],
      reachableFunctions: [],
      functionCalls: [],
    };
  }
  const constructionDescriptor = collectClassConstruction(classNode, renderMethod, context);
  const constructionId = createSemanticId(
    "class-construction",
    identity.descriptor.name,
    classNode,
    context,
  );
  const constructionIssues = constructionDescriptor.issues.map((issue) => ({
    kind: issue.kind,
    location: getNodeLocation(issue.node, context.rootDirectory),
    status: issue.status,
  }));
  let constructionStatus = ReactClassConstructionStatus.Valid;
  if (
    constructionIssues.some((issue) => issue.status === ReactClassConstructionIssueStatus.Violated)
  ) {
    constructionStatus = ReactClassConstructionStatus.Invalid;
  } else if (
    constructionIssues.some((issue) => issue.status === ReactClassConstructionIssueStatus.Unknown)
  ) {
    constructionStatus = ReactClassConstructionStatus.Unknown;
  }
  const construction: ReactSemanticClassConstruction = {
    id: constructionId,
    ownerId: identity.semanticUnit.id,
    phase: ReactExecutionPhase.ClassConstruction,
    location: getNodeLocation(classNode, context.rootDirectory),
    constructorLocation: constructionDescriptor.constructorDeclaration
      ? getNodeLocation(constructionDescriptor.constructorDeclaration, context.rootDirectory)
      : null,
    initializationKind: constructionDescriptor.initializationKind,
    initializationLocation: constructionDescriptor.initializationNode
      ? getNodeLocation(constructionDescriptor.initializationNode, context.rootDirectory)
      : null,
    stateRequirement: constructionDescriptor.stateRequirement,
    issues: constructionIssues,
    status: constructionStatus,
    sourceComplete: constructionStatus !== ReactClassConstructionStatus.Unknown,
    complete: constructionStatus === ReactClassConstructionStatus.Valid,
  };
  const mountMethod = getClassMethodDeclaration(classNode, "componentDidMount");
  const unmountMethod = getClassMethodDeclaration(classNode, "componentWillUnmount");
  const updateMethod = getClassMethodDeclaration(classNode, "componentDidUpdate");
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const createLifecycleCallback = (
    method: ts.MethodDeclaration | null,
    kind: ReactSemanticCallbackKind,
    phase: ReactExecutionPhase,
    name: string,
  ): ReactSemanticCallback | null => {
    if (!method) return null;
    const callback = createCallbackFact(
      identity,
      method,
      method,
      new Set(),
      kind,
      phase,
      name,
      context,
    );
    callbacks.push(callback);
    const reachabilityFacts = collectReachabilityGraphFacts(identity, method, callback, context);
    reachableFunctions.push(...reachabilityFacts.reachableFunctions);
    functionCalls.push(...reachabilityFacts.functionCalls);
    return callback;
  };
  const mountCallback = createLifecycleCallback(
    mountMethod,
    ReactSemanticCallbackKind.ClassMount,
    ReactExecutionPhase.ClassMount,
    "componentDidMount",
  );
  const unmountCallback = createLifecycleCallback(
    unmountMethod,
    ReactSemanticCallbackKind.ClassUnmount,
    ReactExecutionPhase.ClassUnmount,
    "componentWillUnmount",
  );
  const updateCallback = createLifecycleCallback(
    updateMethod,
    ReactSemanticCallbackKind.ClassUpdate,
    ReactExecutionPhase.ClassUpdate,
    "componentDidUpdate",
  );
  const stateWriteRoots: ClassStateWriteRootDescriptor[] = [];
  if (mountMethod && mountCallback) {
    stateWriteRoots.push({
      callbackId: mountCallback.id,
      functionNode: mountMethod,
      phase: ReactExecutionPhase.ClassMount,
    });
  }
  if (unmountMethod && unmountCallback) {
    stateWriteRoots.push({
      callbackId: unmountCallback.id,
      functionNode: unmountMethod,
      phase: ReactExecutionPhase.ClassUnmount,
    });
  }
  if (updateMethod && updateCallback) {
    stateWriteRoots.push({
      callbackId: updateCallback.id,
      functionNode: updateMethod,
      phase: ReactExecutionPhase.ClassUpdate,
    });
  }
  const resourceProtocols = mountMethod
    ? collectLifecycleResourceProtocols(
        mountMethod,
        unmountMethod ? [unmountMethod] : [],
        Boolean(unmountMethod),
        context,
      )
    : [];
  const schedulerProtocols = mountMethod
    ? collectLifecycleSchedulerProtocols(
        mountMethod,
        unmountMethod ? [unmountMethod] : [],
        Boolean(unmountMethod),
        context,
      )
    : [];
  const transitionDescriptors = identity.descriptor.classComponentBase
    ? collectClassStateTransitions(
        mountMethod,
        updateMethod,
        identity.descriptor.classComponentBase,
        context,
      )
    : [];
  const transitions: ReactSemanticClassStateTransition[] = [];
  const transitionUpdaterFunctions = new Set<ts.FunctionLikeDeclaration>();
  for (const descriptor of transitionDescriptors) {
    const transitionId = createSemanticId(
      "class-state-transition",
      descriptor.phase,
      descriptor.callExpression,
      context,
    );
    const updaterCallback = descriptor.updaterFunction
      ? createCallbackFact(
          identity,
          descriptor.updaterFunction,
          descriptor.updaterFunction,
          new Set(),
          ReactSemanticCallbackKind.ClassStateUpdater,
          ReactExecutionPhase.StateTransition,
          "class-state-updater",
          context,
        )
      : null;
    const identifiedUpdaterCallback =
      updaterCallback && descriptor.updaterFunction
        ? {
            ...updaterCallback,
            id: createSemanticId(
              `class-state-updater:${transitionId}`,
              "updater",
              descriptor.updaterFunction,
              context,
            ),
          }
        : null;
    if (identifiedUpdaterCallback && descriptor.updaterFunction) {
      stateWriteRoots.push({
        callbackId: identifiedUpdaterCallback.id,
        functionNode: descriptor.updaterFunction,
        phase: ReactExecutionPhase.StateTransition,
      });
      transitionUpdaterFunctions.add(descriptor.updaterFunction);
      callbacks.push(identifiedUpdaterCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        descriptor.updaterFunction,
        identifiedUpdaterCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const lifecycleCallback =
      descriptor.phase === ReactExecutionPhase.ClassMount ? mountCallback : updateCallback;
    const hasSafeUpdater =
      descriptor.updaterStatus !== ReactClassStateUpdaterStatus.Impure &&
      descriptor.updaterStatus !== ReactClassStateUpdaterStatus.Unknown;
    const hasSafeCycle =
      descriptor.cycleStatus !== ReactClassUpdateCycleStatus.Guaranteed &&
      descriptor.cycleStatus !== ReactClassUpdateCycleStatus.Unknown;
    transitions.push({
      id: transitionId,
      ownerId: identity.semanticUnit.id,
      lifecycleCallbackId: lifecycleCallback?.id ?? "",
      updaterCallbackId: identifiedUpdaterCallback?.id ?? null,
      phase: descriptor.phase,
      location: getNodeLocation(descriptor.callExpression, context.rootDirectory),
      guardLocations: descriptor.guardNodes.map((guardNode) =>
        getNodeLocation(guardNode, context.rootDirectory),
      ),
      updaterStatus: descriptor.updaterStatus,
      cycleStatus: descriptor.cycleStatus,
      commitCallbackProvided: descriptor.commitCallbackProvided,
      sourceComplete: descriptor.isSourceComplete,
      complete:
        descriptor.isSourceComplete && hasSafeUpdater && hasSafeCycle && Boolean(lifecycleCallback),
    });
  }
  const resources: ReactSemanticEffectResource[] = [];
  const resourceCallbackFunctions = new Set<ts.FunctionLikeDeclaration>();
  for (const protocol of resourceProtocols) {
    const resourceId = createSemanticId(
      "class-resource",
      protocol.kind,
      protocol.acquisitionNode,
      context,
    );
    const callbackFunction = protocol.callbackExpression
      ? resolveFunction(protocol.callbackExpression, context.typeChecker)
      : null;
    if (callbackFunction) resourceCallbackFunctions.add(callbackFunction);
    const resourceCallback = callbackFunction
      ? createCallbackFact(
          identity,
          callbackFunction,
          callbackFunction,
          new Set(),
          ReactSemanticCallbackKind.ResourceCallback,
          ReactExecutionPhase.Deferred,
          protocol.kind,
          context,
        )
      : null;
    const identifiedResourceCallback =
      resourceCallback && callbackFunction
        ? {
            ...resourceCallback,
            id: createSemanticId(
              `resource-callback:${resourceId}`,
              protocol.kind,
              callbackFunction,
              context,
            ),
          }
        : null;
    if (identifiedResourceCallback && callbackFunction) {
      stateWriteRoots.push({
        callbackId: identifiedResourceCallback.id,
        functionNode: callbackFunction,
        phase: ReactExecutionPhase.Deferred,
      });
      callbacks.push(identifiedResourceCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        callbackFunction,
        identifiedResourceCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const callbackComplete = Boolean(
      callbackFunction &&
      identifiedResourceCallback &&
      isDeferredCallbackSynchronous(callbackFunction, context),
    );
    resources.push({
      id: resourceId,
      ownerId: identity.semanticUnit.id,
      effectId: null,
      acquisitionCallbackId: mountCallback?.id ?? "",
      kind: protocol.kind,
      phase: ReactExecutionPhase.Deferred,
      location: getNodeLocation(protocol.acquisitionNode, context.rootDirectory),
      activationLocations: protocol.acquisitionNodes.map((acquisitionNode) =>
        getNodeLocation(acquisitionNode, context.rootDirectory),
      ),
      callbackIds: identifiedResourceCallback ? [identifiedResourceCallback.id] : [],
      callbackComplete,
      disposalStatus: protocol.disposalStatus,
      disposalLocations: protocol.disposalCalls.map((disposalCall) =>
        getNodeLocation(disposalCall, context.rootDirectory),
      ),
      sourceComplete: protocol.isSourceComplete,
      complete: protocol.isSourceComplete && callbackComplete && Boolean(mountCallback),
    });
  }
  const schedulers: ReactSemanticScheduler[] = [];
  const schedulerCallbackFunctions = new Set<ts.FunctionLikeDeclaration>();
  for (const protocol of schedulerProtocols) {
    const schedulerId = createSemanticId(
      "class-scheduler",
      protocol.kind,
      protocol.registrationCall,
      context,
    );
    const callbackFunction = protocol.callbackExpression
      ? resolveFunction(protocol.callbackExpression, context.typeChecker)
      : null;
    if (callbackFunction) schedulerCallbackFunctions.add(callbackFunction);
    const schedulerCallback = callbackFunction
      ? createCallbackFact(
          identity,
          callbackFunction,
          callbackFunction,
          new Set(),
          ReactSemanticCallbackKind.ScheduledCallback,
          ReactExecutionPhase.Deferred,
          protocol.kind,
          context,
        )
      : null;
    const identifiedSchedulerCallback =
      schedulerCallback && callbackFunction
        ? {
            ...schedulerCallback,
            id: createSemanticId(
              `scheduler-callback:${schedulerId}`,
              protocol.kind,
              callbackFunction,
              context,
            ),
          }
        : null;
    if (identifiedSchedulerCallback && callbackFunction) {
      stateWriteRoots.push({
        callbackId: identifiedSchedulerCallback.id,
        functionNode: callbackFunction,
        phase: ReactExecutionPhase.Deferred,
      });
      callbacks.push(identifiedSchedulerCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        callbackFunction,
        identifiedSchedulerCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const callbackComplete = Boolean(
      callbackFunction &&
      identifiedSchedulerCallback &&
      isDeferredCallbackSynchronous(callbackFunction, context),
    );
    schedulers.push({
      id: schedulerId,
      ownerId: identity.semanticUnit.id,
      effectId: null,
      registrationCallbackId: mountCallback?.id ?? "",
      kind: protocol.kind,
      phase: ReactExecutionPhase.Deferred,
      location: getNodeLocation(protocol.registrationCall, context.rootDirectory),
      callbackIds: identifiedSchedulerCallback ? [identifiedSchedulerCallback.id] : [],
      callbackComplete,
      cancellationStatus: protocol.cancellationStatus,
      cancellationLocations: protocol.cancellationCalls.map((cancellationCall) =>
        getNodeLocation(cancellationCall, context.rootDirectory),
      ),
      sourceComplete: protocol.isSourceComplete,
      complete: protocol.isSourceComplete && callbackComplete && Boolean(mountCallback),
    });
  }
  const stateWrites: ReactSemanticClassStateWrite[] = collectClassStateWrites(
    stateWriteRoots,
    context,
  ).map((descriptor) => ({
    id: createSemanticId(
      `class-state-write:${descriptor.callbackId}`,
      descriptor.kind,
      descriptor.node,
      context,
    ),
    ownerId: identity.semanticUnit.id,
    callbackId: descriptor.callbackId,
    phase: descriptor.phase,
    location: getNodeLocation(descriptor.node, context.rootDirectory),
    kind: descriptor.kind,
    status: descriptor.status,
    sourceComplete: descriptor.status !== ReactClassStateWriteStatus.Unknown,
    complete: false,
  }));
  const representedLifecycleCalls = new Set<ts.CallExpression>([
    ...resourceProtocols.flatMap((protocol) => [
      ...protocol.acquisitionNodes.filter(ts.isCallExpression),
      ...protocol.disposalCalls,
    ]),
    ...schedulerProtocols.flatMap((protocol) => [
      protocol.registrationCall,
      ...protocol.cancellationCalls,
    ]),
    ...transitionDescriptors.map((descriptor) => descriptor.callExpression),
  ]);
  const lifecycleCalls = [
    ...(mountMethod ? collectReachableCallExpressions(mountMethod, context.typeChecker) : []),
    ...(unmountMethod ? collectReachableCallExpressions(unmountMethod, context.typeChecker) : []),
    ...(updateMethod ? collectReachableCallExpressions(updateMethod, context.typeChecker) : []),
  ];
  const representedClassMembers = new Set<ts.ClassElement>([
    renderMethod,
    ...constructionDescriptor.representedMembers,
    ...(mountMethod ? [mountMethod] : []),
    ...(unmountMethod ? [unmountMethod] : []),
    ...(updateMethod ? [updateMethod] : []),
    ...[...resourceCallbackFunctions].filter(ts.isMethodDeclaration),
    ...[...schedulerCallbackFunctions].filter(ts.isMethodDeclaration),
    ...[...transitionUpdaterFunctions].filter(ts.isMethodDeclaration),
    ...schedulerProtocols.flatMap((protocol) =>
      protocol.handleDeclaration ? [protocol.handleDeclaration] : [],
    ),
  ]);
  const sourceComplete =
    identity.descriptor.sourceComplete &&
    construction.sourceComplete &&
    classNode.members.every((member) => representedClassMembers.has(member)) &&
    lifecycleCalls.every((callExpression) => representedLifecycleCalls.has(callExpression));
  const lifecycleId = createSemanticId(
    "class-lifecycle",
    identity.descriptor.name,
    classNode,
    context,
  );
  return {
    construction,
    lifecycle: {
      id: lifecycleId,
      ownerId: identity.semanticUnit.id,
      location: getNodeLocation(classNode, context.rootDirectory),
      constructionId,
      mountCallbackId: mountCallback?.id ?? null,
      unmountCallbackId: unmountCallback?.id ?? null,
      updateCallbackId: updateCallback?.id ?? null,
      resourceIds: resources.map((resource) => resource.id),
      schedulerIds: schedulers.map((scheduler) => scheduler.id),
      stateWriteIds: stateWrites.map((stateWrite) => stateWrite.id),
      transitionIds: transitions.map((transition) => transition.id),
      sourceComplete,
      complete:
        sourceComplete &&
        construction.complete &&
        resources.every((resource) => resource.complete) &&
        schedulers.every((scheduler) => scheduler.complete) &&
        stateWrites.every((stateWrite) => stateWrite.complete) &&
        transitions.every((transition) => transition.complete),
    },
    stateWrites,
    transitions,
    schedulers,
    resources,
    callbacks,
    reachableFunctions,
    functionCalls,
  };
};

const collectAsyncTaskGraph = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactSemanticAsyncTask> => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode || identity.descriptor.kind === ReactUnitKind.InvalidHookOwner) return [];
  return collectAsyncEffectTaskDescriptors(functionNode, context).map((task) => {
    const hookName = getCanonicalHookName(task.effectCall, context.typeChecker) ?? "unknown-effect";
    return {
      id: createSemanticId("async-task", "continuation", task.taskNode, context),
      ownerId: identity.semanticUnit.id,
      effectId: createSemanticId("effect", hookName, task.effectCall, context),
      location: getNodeLocation(task.taskNode, context.rootDirectory),
      stateWrites: task.stateWriteNames,
      ownershipStatus: task.status,
    };
  });
};

const collectEventGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  context: ReactAnalysisContext,
  eventFlow: ComponentCallbackFlowDescriptor,
): EventGraphFacts => {
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const identitiesByFunction = new Map(
    identities.flatMap(
      (identity): ReadonlyArray<[ts.FunctionLikeDeclaration, UnitGraphIdentity]> =>
        identity.descriptor.functionNode ? [[identity.descriptor.functionNode, identity]] : [],
    ),
  );
  const callbackFactsByOwner = new Map<
    ts.FunctionLikeDeclaration,
    Map<ts.FunctionLikeDeclaration, ReactSemanticCallback>
  >();
  for (const callbackDescriptor of eventFlow.bindings.flatMap((binding) => binding.callbacks)) {
    const identity = identitiesByFunction.get(callbackDescriptor.ownerFunction);
    if (!identity) continue;
    const hookBindings = collectHookBindings(callbackDescriptor.ownerFunction, context.typeChecker);
    const stableSymbols = new Set([...hookBindings.refs, ...hookBindings.stateSetters]);
    const callbackFact = createCallbackFact(
      identity,
      callbackDescriptor.callbackFunction,
      callbackDescriptor.ownerFunction,
      stableSymbols,
      ReactSemanticCallbackKind.EventHandler,
      ReactExecutionPhase.Event,
      "event handler",
      context,
    );
    callbacks.push(callbackFact);
    const ownerCallbackFacts =
      callbackFactsByOwner.get(callbackDescriptor.ownerFunction) ?? new Map();
    ownerCallbackFacts.set(callbackDescriptor.callbackFunction, callbackFact);
    callbackFactsByOwner.set(callbackDescriptor.ownerFunction, ownerCallbackFacts);
    const reachabilityFacts = collectReachabilityGraphFacts(
      identity,
      callbackDescriptor.callbackFunction,
      callbackFact,
      context,
      callbackDescriptor.bindings,
    );
    reachableFunctions.push(...reachabilityFacts.reachableFunctions);
    functionCalls.push(...reachabilityFacts.functionCalls);
  }
  const getCallbackIds = (
    callbackDescriptors: ReadonlyArray<{
      callbackFunction: ts.FunctionLikeDeclaration;
      ownerFunction: ts.FunctionLikeDeclaration;
    }>,
  ): ReadonlyArray<string> =>
    callbackDescriptors.flatMap((callbackDescriptor) => {
      const callbackFact = callbackFactsByOwner
        .get(callbackDescriptor.ownerFunction)
        ?.get(callbackDescriptor.callbackFunction);
      return callbackFact ? [callbackFact.id] : [];
    });
  const eventBindings = eventFlow.bindings.flatMap(
    (binding): ReadonlyArray<ReactSemanticEventBinding> => {
      const identity = identitiesByFunction.get(binding.ownerFunction);
      if (!identity) return [];
      return [
        {
          id: createSemanticId(
            `event-binding:${identity.semanticUnit.id}`,
            binding.eventName,
            binding.node,
            context,
          ),
          ownerId: identity.semanticUnit.id,
          eventName: binding.eventName,
          location: getNodeLocation(binding.node, context.rootDirectory),
          callbackIds: getCallbackIds(binding.callbacks),
          complete: binding.isComplete,
        },
      ];
    },
  );
  return {
    callbacks,
    reachableFunctions,
    functionCalls,
    eventBindings,
  };
};

const getCallbackKindForPhase = (phase: ReactExecutionPhase): ReactSemanticCallbackKind | null => {
  if (phase === ReactExecutionPhase.Event) return ReactSemanticCallbackKind.EventHandler;
  if (phase === ReactExecutionPhase.EffectSetup) {
    return ReactSemanticCallbackKind.EffectSetup;
  }
  if (phase === ReactExecutionPhase.EffectCleanup) {
    return ReactSemanticCallbackKind.EffectCleanup;
  }
  if (phase === ReactExecutionPhase.ExternalStoreSubscription) {
    return ReactSemanticCallbackKind.ExternalStoreSubscribe;
  }
  if (phase === ReactExecutionPhase.ServerRender) {
    return ReactSemanticCallbackKind.ServerSnapshot;
  }
  return null;
};

const collectCallbackPropGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  context: ReactAnalysisContext,
  componentFlow: ComponentCallbackFlowDescriptor,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
): CallbackPropGraphFacts => {
  const identitiesByFunction = new Map(
    identities.flatMap(
      (identity): ReadonlyArray<[ts.FunctionLikeDeclaration, UnitGraphIdentity]> =>
        identity.descriptor.functionNode ? [[identity.descriptor.functionNode, identity]] : [],
    ),
  );
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const callbackReachabilityById = new Map<string, CallbackPropReachabilityDescriptor>();
  const callbackPropFlows = componentFlow
    .collectPropFlows()
    .flatMap((propFlow): ReadonlyArray<ReactSemanticCallbackPropFlow> => {
      const renderOwner = identitiesByFunction.get(propFlow.renderOwnerFunction);
      const targetOwner = identitiesByFunction.get(propFlow.targetFunction);
      const callbackKind = getCallbackKindForPhase(propFlow.phase);
      if (!renderOwner || !targetOwner) return [];
      const alternatives = propFlow.callbacks.flatMap(
        (callbackDescriptor): ReadonlyArray<ReactSemanticCallbackPropAlternative> => {
          const identity = identitiesByFunction.get(callbackDescriptor.ownerFunction);
          if (!identity) return [];
          const callbackLocation = getNodeLocation(
            callbackDescriptor.callbackFunction,
            context.rootDirectory,
          );
          const existingCallback = existingCallbacks.find(
            (callback) =>
              callback.ownerId === identity.semanticUnit.id &&
              callback.phase === propFlow.phase &&
              callback.location.filePath === callbackLocation.filePath &&
              callback.location.line === callbackLocation.line &&
              callback.location.column === callbackLocation.column,
          );
          if (existingCallback) {
            return [
              createCallbackPropAlternative(existingCallback.id, callbackDescriptor, context),
            ];
          }
          const createdCallback = callbacks.find(
            (callback) =>
              callback.ownerId === identity.semanticUnit.id &&
              callback.phase === propFlow.phase &&
              callback.location.filePath === callbackLocation.filePath &&
              callback.location.line === callbackLocation.line &&
              callback.location.column === callbackLocation.column,
          );
          if (createdCallback) {
            const reachabilityDescriptor = callbackReachabilityById.get(createdCallback.id);
            if (reachabilityDescriptor) {
              callbackReachabilityById.set(createdCallback.id, {
                ...reachabilityDescriptor,
                callbackDescriptor: {
                  ...reachabilityDescriptor.callbackDescriptor,
                  bindings: mergeCallableBindings([
                    reachabilityDescriptor.callbackDescriptor.bindings,
                    callbackDescriptor.bindings,
                  ]),
                },
              });
            }
            return [createCallbackPropAlternative(createdCallback.id, callbackDescriptor, context)];
          }
          if (!callbackKind) return [];
          const hookBindings = collectHookBindings(
            callbackDescriptor.ownerFunction,
            context.typeChecker,
          );
          const stableSymbols = new Set([...hookBindings.refs, ...hookBindings.stateSetters]);
          const callbackFact = createCallbackFact(
            identity,
            callbackDescriptor.callbackFunction,
            callbackDescriptor.ownerFunction,
            stableSymbols,
            callbackKind,
            propFlow.phase,
            `callback prop ${propFlow.propName}`,
            context,
          );
          callbacks.push(callbackFact);
          callbackReachabilityById.set(callbackFact.id, {
            callbackDescriptor,
            callbackFact,
            identity,
          });
          return [createCallbackPropAlternative(callbackFact.id, callbackDescriptor, context)];
        },
      );
      const callbackIds = [...new Set(alternatives.map((alternative) => alternative.callbackId))];
      return [
        {
          id: createSemanticId(
            `callback-prop-flow:${propFlow.phase}:${renderOwner.semanticUnit.id}:${targetOwner.semanticUnit.id}`,
            propFlow.propName,
            propFlow.node,
            context,
          ),
          renderId: createSemanticId(
            "render",
            targetOwner.semanticUnit.id,
            propFlow.renderNode.tagName,
            context,
          ),
          renderOwnerId: renderOwner.semanticUnit.id,
          targetOwnerId: targetOwner.semanticUnit.id,
          propName: propFlow.propName,
          phase: propFlow.phase,
          location: getNodeLocation(propFlow.node, context.rootDirectory),
          alternatives,
          callbackIds,
          complete: propFlow.isComplete && alternatives.length === propFlow.callbacks.length,
        },
      ];
    });
  for (const reachabilityDescriptor of callbackReachabilityById.values()) {
    const reachabilityFacts = collectReachabilityGraphFacts(
      reachabilityDescriptor.identity,
      reachabilityDescriptor.callbackDescriptor.callbackFunction,
      reachabilityDescriptor.callbackFact,
      context,
      reachabilityDescriptor.callbackDescriptor.bindings,
    );
    reachableFunctions.push(...reachabilityFacts.reachableFunctions);
    functionCalls.push(...reachabilityFacts.functionCalls);
  }
  return { callbacks, reachableFunctions, functionCalls, callbackPropFlows };
};

const collectMemoCallbacks = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): CallbackGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode) return { callbacks: [], reachableFunctions: [], functionCalls: [] };
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([...hookBindings.refs, ...hookBindings.stateSetters]);
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  for (const hookCall of collectHookCalls(
    functionNode,
    REACT_MEMO_HOOK_NAMES,
    context.typeChecker,
  )) {
    const hookName = getCanonicalHookName(hookCall, context.typeChecker) ?? "memo-hook";
    const callbackExpression = hookCall.arguments[0];
    const callback = callbackExpression
      ? resolveFunction(callbackExpression, context.typeChecker)
      : null;
    if (!callback) continue;
    const isMemoFactory = hookName === "useMemo";
    const callbackFact = createCallbackFact(
      identity,
      callback,
      functionNode,
      stableSymbols,
      isMemoFactory
        ? ReactSemanticCallbackKind.MemoFactory
        : ReactSemanticCallbackKind.MemoizedCallback,
      isMemoFactory ? ReactExecutionPhase.Render : ReactExecutionPhase.Deferred,
      hookName,
      context,
    );
    callbacks.push(callbackFact);
    const reachabilityFacts = collectReachabilityGraphFacts(
      identity,
      callback,
      callbackFact,
      context,
    );
    reachableFunctions.push(...reachabilityFacts.reachableFunctions);
    functionCalls.push(...reachabilityFacts.functionCalls);
  }
  return { callbacks, reachableFunctions, functionCalls };
};

const collectReducerCallbacks = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): CallbackGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode) return { callbacks: [], reachableFunctions: [], functionCalls: [] };
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const callbackDescriptors: ReadonlyArray<ReducerCallbackDescriptor> = [
    {
      argumentIndex: 0,
      kind: ReactSemanticCallbackKind.Reducer,
      name: "reducer",
    },
    {
      argumentIndex: 2,
      kind: ReactSemanticCallbackKind.ReducerInitializer,
      name: "reducer-initializer",
    },
  ];
  for (const hookCall of collectHookCalls(
    functionNode,
    REACT_REDUCER_HOOK_NAMES,
    context.typeChecker,
  )) {
    for (const descriptor of callbackDescriptors) {
      const callbackExpression = hookCall.arguments[descriptor.argumentIndex];
      const callback = callbackExpression
        ? resolveFunction(callbackExpression, context.typeChecker)
        : null;
      if (!callback) continue;
      const callbackFact = createCallbackFact(
        identity,
        callback,
        functionNode,
        new Set(),
        descriptor.kind,
        ReactExecutionPhase.StateTransition,
        descriptor.name,
        context,
      );
      callbacks.push(callbackFact);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        callback,
        callbackFact,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
  }
  return { callbacks, reachableFunctions, functionCalls };
};

const collectExternalStoreGraph = (
  identity: UnitGraphIdentity,
  identitiesByFunction: ReadonlyMap<ts.FunctionLikeDeclaration, UnitGraphIdentity>,
  context: ReactAnalysisContext,
  componentFlow: ComponentCallbackFlowDescriptor,
): ExternalStoreGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode || identity.descriptor.kind === ReactUnitKind.InvalidHookOwner) {
    return { externalStores: [], callbacks: [], reachableFunctions: [], functionCalls: [] };
  }
  const externalStores: ReactSemanticExternalStore[] = [];
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const collectCallbackFacts = (
    expression: ts.Expression | undefined,
    descriptor: ExternalStoreCallbackDescriptor,
    isOptional: boolean,
  ): ExternalStoreCallbackFacts => {
    if (!expression) {
      return {
        callbackIds: [],
        callbacks: [],
        isComplete: isOptional,
        reachableFunctions: [],
        functionCalls: [],
      };
    }
    const resolution = componentFlow.resolveExpression(expression, functionNode, descriptor.phase);
    const resolvedCallbacks: ReactSemanticCallback[] = [];
    const resolvedReachableFunctions: ReactSemanticReachableFunction[] = [];
    const resolvedFunctionCalls: ReactSemanticFunctionCall[] = [];
    for (const callbackDescriptor of resolution.callbacks) {
      const callbackOwner = identitiesByFunction.get(callbackDescriptor.ownerFunction) ?? identity;
      const ownerHookBindings = collectHookBindings(
        callbackDescriptor.ownerFunction,
        context.typeChecker,
      );
      const ownerStableSymbols = new Set([
        ...ownerHookBindings.refs,
        ...ownerHookBindings.stateSetters,
      ]);
      const callbackFact = createCallbackFact(
        callbackOwner,
        callbackDescriptor.callbackFunction,
        callbackDescriptor.ownerFunction,
        ownerStableSymbols,
        descriptor.kind,
        descriptor.phase,
        descriptor.name,
        context,
      );
      resolvedCallbacks.push(callbackFact);
      const reachabilityFacts = collectReachabilityGraphFacts(
        callbackOwner,
        callbackDescriptor.callbackFunction,
        callbackFact,
        context,
        callbackDescriptor.bindings,
      );
      resolvedReachableFunctions.push(...reachabilityFacts.reachableFunctions);
      resolvedFunctionCalls.push(...reachabilityFacts.functionCalls);
    }
    return {
      callbackIds: resolvedCallbacks.map((callback) => callback.id),
      callbacks: resolvedCallbacks,
      isComplete: resolution.isComplete && resolvedCallbacks.length > 0,
      reachableFunctions: resolvedReachableFunctions,
      functionCalls: resolvedFunctionCalls,
    };
  };
  for (const hookCall of collectHookCalls(
    functionNode,
    REACT_EXTERNAL_STORE_HOOK_NAMES,
    context.typeChecker,
  )) {
    const subscribeExpression = hookCall.arguments[0];
    const snapshotExpression = hookCall.arguments[1];
    const serverSnapshotExpression = hookCall.arguments[2];
    const subscribeFacts = collectCallbackFacts(
      subscribeExpression,
      {
        kind: ReactSemanticCallbackKind.ExternalStoreSubscribe,
        name: "subscribe",
        phase: ReactExecutionPhase.ExternalStoreSubscription,
      },
      false,
    );
    const snapshotFacts = collectCallbackFacts(
      snapshotExpression,
      {
        kind: ReactSemanticCallbackKind.ExternalStoreSnapshot,
        name: "getSnapshot",
        phase: ReactExecutionPhase.Render,
      },
      false,
    );
    const serverSnapshotFacts = collectCallbackFacts(
      serverSnapshotExpression,
      {
        kind: ReactSemanticCallbackKind.ServerSnapshot,
        name: "getServerSnapshot",
        phase: ReactExecutionPhase.ServerRender,
      },
      true,
    );
    callbacks.push(
      ...subscribeFacts.callbacks,
      ...snapshotFacts.callbacks,
      ...serverSnapshotFacts.callbacks,
    );
    reachableFunctions.push(
      ...subscribeFacts.reachableFunctions,
      ...snapshotFacts.reachableFunctions,
      ...serverSnapshotFacts.reachableFunctions,
    );
    functionCalls.push(
      ...subscribeFacts.functionCalls,
      ...snapshotFacts.functionCalls,
      ...serverSnapshotFacts.functionCalls,
    );
    externalStores.push({
      id: createSemanticId("external-store", "useSyncExternalStore", hookCall, context),
      ownerId: identity.semanticUnit.id,
      location: getNodeLocation(hookCall, context.rootDirectory),
      subscribeCallbackIds: subscribeFacts.callbackIds,
      subscribeComplete: subscribeFacts.isComplete,
      snapshotCallbackIds: snapshotFacts.callbackIds,
      snapshotComplete: snapshotFacts.isComplete,
      serverSnapshotCallbackIds: serverSnapshotFacts.callbackIds,
      serverSnapshotComplete: serverSnapshotFacts.isComplete,
      serverSnapshotProvided: Boolean(serverSnapshotExpression),
    });
  }
  return { externalStores, callbacks, reachableFunctions, functionCalls };
};

const collectEffectEventGraph = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): EffectEventGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode || identity.descriptor.kind === ReactUnitKind.InvalidHookOwner) {
    return { effectEvents: [], callbacks: [], reachableFunctions: [], functionCalls: [] };
  }
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const nonReactiveSymbols = new Set([
    ...hookBindings.effectEvents,
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
  ]);
  const effectEvents: ReactSemanticEffectEvent[] = [];
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  for (const binding of collectEffectEventBindings(functionNode, context.typeChecker)) {
    const callback = binding.callback
      ? createCallbackFact(
          identity,
          binding.callback,
          functionNode,
          nonReactiveSymbols,
          ReactSemanticCallbackKind.EffectEvent,
          ReactExecutionPhase.EffectEvent,
          binding.name,
          context,
        )
      : null;
    if (callback && binding.callback) {
      callbacks.push(callback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        binding.callback,
        callback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    effectEvents.push({
      id: createSemanticId("effect-event", binding.name, binding.callExpression, context),
      ownerId: identity.semanticUnit.id,
      name: binding.name,
      location: getNodeLocation(binding.callExpression, context.rootDirectory),
      callbackId: callback?.id ?? null,
      identityStability: ReactIdentityStability.Unstable,
    });
  }
  return { effectEvents, callbacks, reachableFunctions, functionCalls };
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

const getNearestProvider = (
  providerIds: ReadonlyArray<string>,
  contextId: string,
  providersById: ReadonlyMap<string, ReactSemanticContextProvider>,
): ReactSemanticContextProvider | null =>
  providerIds
    .toReversed()
    .map((providerId) => providersById.get(providerId))
    .find((provider) => provider?.contextId === contextId) ?? null;

const resolveContextConsumers = (
  units: ReadonlyArray<ReactSemanticUnit>,
  edges: ReadonlyArray<ReactSemanticEdge>,
  renders: ReadonlyArray<ReactSemanticRender>,
  contexts: ReadonlyArray<ReactSemanticContext>,
  providers: ReadonlyArray<ReactSemanticContextProvider>,
  consumers: ReadonlyArray<ReactSemanticContextConsumer>,
): ReadonlyArray<ReactSemanticContextConsumer> => {
  const localUnitIds = new Set(units.map((unit) => unit.id));
  const customHookEdges = edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && localUnitIds.has(edge.targetId),
  );
  const incomingUnitIds = new Set([
    ...renders.map((render) => render.targetId),
    ...customHookEdges.map((edge) => edge.targetId),
  ]);
  const rootUnitIds = units.map((unit) => unit.id).filter((unitId) => !incomingUnitIds.has(unitId));
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const sourcesByUnit = new Map<string, Map<string, Set<string>>>();

  for (const rootUnitId of rootUnitIds) {
    for (const context of contexts) {
      addContextSource(sourcesByUnit, rootUnitId, context.id, REACT_CONTEXT_DEFAULT_SOURCE_ID);
    }
  }

  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of renders) {
      for (const context of contexts) {
        const nearestProvider = getNearestProvider(
          render.activeContextProviderIds,
          context.id,
          providersById,
        );
        if (nearestProvider) {
          didSourcesChange =
            addContextSource(sourcesByUnit, render.targetId, context.id, nearestProvider.id) ||
            didSourcesChange;
          continue;
        }
        const parentSources = sourcesByUnit.get(render.ownerId)?.get(context.id) ?? [];
        for (const sourceId of parentSources) {
          didSourcesChange =
            addContextSource(sourcesByUnit, render.targetId, context.id, sourceId) ||
            didSourcesChange;
        }
      }
    }
    for (const hookEdge of customHookEdges) {
      for (const context of contexts) {
        const ownerSources = sourcesByUnit.get(hookEdge.sourceId)?.get(context.id) ?? [];
        for (const sourceId of ownerSources) {
          didSourcesChange =
            addContextSource(sourcesByUnit, hookEdge.targetId, context.id, sourceId) ||
            didSourcesChange;
        }
      }
    }
  }

  return consumers.map((consumer) => {
    if (!consumer.contextId) return consumer;
    const sourceIds = [...(sourcesByUnit.get(consumer.ownerId)?.get(consumer.contextId) ?? [])];
    return {
      ...consumer,
      sourceProviderIds: sourceIds.filter(
        (sourceId) => sourceId !== REACT_CONTEXT_DEFAULT_SOURCE_ID,
      ),
      usesDefaultValue: sourceIds.includes(REACT_CONTEXT_DEFAULT_SOURCE_ID),
      topologyComplete: sourceIds.length > 0,
    };
  });
};

export const buildReactSemanticGraph = (
  descriptors: ReadonlyArray<ReactUnitDescriptor>,
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  context: ReactAnalysisContext,
): ReactSemanticGraph => {
  const identities = descriptors.map(
    (descriptor): UnitGraphIdentity => ({
      descriptor,
      semanticUnit: {
        id: createSemanticId("unit", descriptor.name, descriptor.node, context),
        name: descriptor.name,
        kind: descriptor.kind,
        classComponentBase: descriptor.classComponentBase ?? null,
        location: getNodeLocation(descriptor.node, context.rootDirectory),
        sourceComplete: descriptor.sourceComplete,
      },
    }),
  );
  const unitIdentitiesBySymbol = collectUnitIdentitiesBySymbol(identities, context);
  const unitIdsBySymbol = new Map(
    [...unitIdentitiesBySymbol].map(([symbol, identity]) => [symbol, identity.semanticUnit.id]),
  );
  const unitIdentitiesByFunction = new Map(
    identities.flatMap(
      (identity): ReadonlyArray<[ts.FunctionLikeDeclaration, UnitGraphIdentity]> =>
        identity.descriptor.functionNode ? [[identity.descriptor.functionNode, identity]] : [],
    ),
  );
  const contextGraph = collectContextGraph(identities, sourceFiles, context);
  const edges: ReactSemanticEdge[] = [];
  const renders: ReactSemanticRender[] = [];
  const hookCalls: ReactSemanticHookCall[] = [];
  const effects: ReactSemanticEffect[] = [];
  const schedulers: ReactSemanticScheduler[] = [];
  const resources: ReactSemanticEffectResource[] = [];
  const classConstructions: ReactSemanticClassConstruction[] = [];
  const classLifecycles: ReactSemanticClassLifecycle[] = [];
  const classStateWrites: ReactSemanticClassStateWrite[] = [];
  const classStateTransitions: ReactSemanticClassStateTransition[] = [];
  const effectEvents: ReactSemanticEffectEvent[] = [];
  const externalStores: ReactSemanticExternalStore[] = [];
  const asyncTasks: ReactSemanticAsyncTask[] = [];
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const componentFlow = createComponentCallbackFlow(
    [...unitIdentitiesByFunction.keys()],
    new Map(
      [...unitIdentitiesBySymbol].flatMap(
        ([symbol, identity]): ReadonlyArray<[ts.Symbol, ts.FunctionLikeDeclaration]> =>
          identity.descriptor.functionNode ? [[symbol, identity.descriptor.functionNode]] : [],
      ),
    ),
    context.typeChecker,
  );
  const eventGraph = collectEventGraph(identities, context, componentFlow);
  callbacks.push(...eventGraph.callbacks);
  reachableFunctions.push(...eventGraph.reachableFunctions);
  functionCalls.push(...eventGraph.functionCalls);
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (
      functionNode &&
      (identity.descriptor.kind === ReactUnitKind.Component ||
        identity.descriptor.kind === ReactUnitKind.ClassComponent ||
        identity.descriptor.kind === ReactUnitKind.Hook)
    ) {
      const renderCallback = createCallbackFact(
        identity,
        functionNode,
        functionNode,
        new Set(),
        ReactSemanticCallbackKind.ComponentRender,
        ReactExecutionPhase.Render,
        "render",
        context,
      );
      callbacks.push(renderCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        functionNode,
        renderCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const classLifecycleGraph = collectClassLifecycleGraph(identity, context);
    if (classLifecycleGraph.construction) {
      classConstructions.push(classLifecycleGraph.construction);
    }
    if (classLifecycleGraph.lifecycle) {
      classLifecycles.push(classLifecycleGraph.lifecycle);
    }
    classStateWrites.push(...classLifecycleGraph.stateWrites);
    classStateTransitions.push(...classLifecycleGraph.transitions);
    schedulers.push(...classLifecycleGraph.schedulers);
    resources.push(...classLifecycleGraph.resources);
    callbacks.push(...classLifecycleGraph.callbacks);
    reachableFunctions.push(...classLifecycleGraph.reachableFunctions);
    functionCalls.push(...classLifecycleGraph.functionCalls);
    const hookGraph = collectHookGraph(identity, unitIdsBySymbol, context);
    edges.push(...hookGraph.edges);
    hookCalls.push(...hookGraph.hookCalls);
    const renderGraph = collectRenderEdges(
      identity,
      unitIdsBySymbol,
      contextGraph.providersByOpeningNode,
      context,
    );
    edges.push(...renderGraph.edges);
    renders.push(...renderGraph.renders);
    const effectGraph = collectEffectGraph(
      identity,
      unitIdentitiesByFunction,
      context,
      componentFlow,
    );
    effects.push(...effectGraph.effects);
    schedulers.push(...effectGraph.schedulers);
    resources.push(...effectGraph.resources);
    callbacks.push(...effectGraph.callbacks);
    reachableFunctions.push(...effectGraph.reachableFunctions);
    functionCalls.push(...effectGraph.functionCalls);
    asyncTasks.push(...collectAsyncTaskGraph(identity, context));
    const memoGraph = collectMemoCallbacks(identity, context);
    callbacks.push(...memoGraph.callbacks);
    reachableFunctions.push(...memoGraph.reachableFunctions);
    functionCalls.push(...memoGraph.functionCalls);
    const reducerGraph = collectReducerCallbacks(identity, context);
    callbacks.push(...reducerGraph.callbacks);
    reachableFunctions.push(...reducerGraph.reachableFunctions);
    functionCalls.push(...reducerGraph.functionCalls);
    const effectEventGraph = collectEffectEventGraph(identity, context);
    effectEvents.push(...effectEventGraph.effectEvents);
    callbacks.push(...effectEventGraph.callbacks);
    reachableFunctions.push(...effectEventGraph.reachableFunctions);
    functionCalls.push(...effectEventGraph.functionCalls);
    const externalStoreGraph = collectExternalStoreGraph(
      identity,
      unitIdentitiesByFunction,
      context,
      componentFlow,
    );
    externalStores.push(...externalStoreGraph.externalStores);
    callbacks.push(...externalStoreGraph.callbacks);
    reachableFunctions.push(...externalStoreGraph.reachableFunctions);
    functionCalls.push(...externalStoreGraph.functionCalls);
  }
  const callbackPropGraph = collectCallbackPropGraph(identities, context, componentFlow, callbacks);
  callbacks.push(...callbackPropGraph.callbacks);
  reachableFunctions.push(...callbackPropGraph.reachableFunctions);
  functionCalls.push(...callbackPropGraph.functionCalls);
  const contextConsumers = resolveContextConsumers(
    identities.map((identity) => identity.semanticUnit),
    edges,
    renders,
    contextGraph.contexts,
    contextGraph.contextProviders,
    contextGraph.contextConsumers,
  );
  const callableRefs = collectCallableRefGraph(identities, callbacks, functionCalls, context);
  return {
    schemaVersion: REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
    units: identities.map((identity) => identity.semanticUnit),
    edges,
    hookCalls,
    effects,
    effectEvents,
    externalStores,
    asyncTasks,
    contexts: contextGraph.contexts,
    contextProviders: contextGraph.contextProviders,
    contextConsumers,
    renders,
    callbacks,
    reachableFunctions,
    functionCalls,
    eventBindings: eventGraph.eventBindings,
    callbackPropFlows: callbackPropGraph.callbackPropFlows,
    callableRefs,
    schedulers,
    resources,
    classConstructions,
    classLifecycles,
    classStateWrites,
    classStateTransitions,
    compiler: extractReactCompilerGraph(sourceFiles, context.rootDirectory),
  };
};
