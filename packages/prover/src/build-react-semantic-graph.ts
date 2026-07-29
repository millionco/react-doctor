import ts from "typescript";
import { collectActionState } from "./collect-action-state.js";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
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
import { createComponentSlotFlow } from "./create-component-slot-flow.js";
import type { ComponentSlotFlowDescriptor } from "./create-component-slot-flow.js";
import { collectDirectHookCalls } from "./collect-direct-hook-calls.js";
import { collectEffectEventBindings } from "./collect-effect-event-bindings.js";
import { collectErrorBoundaryProtocol } from "./collect-error-boundary-protocol.js";
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
import { collectHookStateTransitions } from "./collect-hook-state-transitions.js";
import { collectImperativeHandles, ImperativeHandleRefKind } from "./collect-imperative-handles.js";
import type {
  ImperativeHandleDescriptor,
  ImperativeHandleMethodDescriptor,
} from "./collect-imperative-handles.js";
import { collectFormActions } from "./collect-form-actions.js";
import { collectOptimisticState } from "./collect-optimistic-state.js";
import { collectReducerTransitions } from "./collect-reducer-transitions.js";
import { collectTransitionActions } from "./collect-transition-actions.js";
import type { TransitionActionDescriptor } from "./collect-transition-actions.js";
import { collectReactiveCaptures } from "./collect-reactive-captures.js";
import { collectReachableFunctionGraph } from "./collect-reachable-functions.js";
import type { ReachableFunctionGraphDescriptor } from "./collect-reachable-functions.js";
import {
  REACT_EXTERNAL_STORE_HOOK_NAMES,
  REACT_MEMO_HOOK_NAMES,
  REACT_CONTEXT_DEFAULT_SOURCE_ID,
  REACT_CONTEXT_UNKNOWN_SOURCE_ID,
  REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID,
  REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID,
  REACT_FORM_OUTSIDE_SOURCE_ID,
  REACT_FORM_UNKNOWN_SOURCE_ID,
  REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
  REACT_SUSPENSE_OWNER_SOURCE_ID,
  REACT_SUSPENSE_OUTSIDE_SOURCE_ID,
  REACT_SUSPENSE_UNKNOWN_SOURCE_ID,
  REACT_TRANSPARENT_COMPONENT_NAMES,
} from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getFunctionName } from "./get-function-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { extractReactCompilerGraph } from "./extract-react-compiler-graph.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";
import { isReactContextExpression } from "./is-react-context-expression.js";
import { resolveFunction } from "./resolve-function.js";
import { summarizeFunctionReturns } from "./summarize-function-returns.js";
import { mergeCallableBindings } from "./resolve-callable-expression.js";
import type { ResolvedCallableValueDescriptor } from "./resolve-callable-expression.js";
import { collectPropertySymbolWrites } from "./utils/collect-property-symbol-writes.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";
import {
  ReactActionStateDispatchKind,
  ReactActionStateDispatchStatus,
  ReactActionStateReducerStatus,
  ReactCallableRefFreshness,
  ReactClassConstructionIssueStatus,
  ReactClassConstructionStatus,
  ReactClassStateUpdaterStatus,
  ReactClassStateWriteStatus,
  ReactClassUpdateCycleStatus,
  ReactEffectDependencyMode,
  ReactErrorBoundaryCoverageStatus,
  ReactErrorBoundaryProtocolStatus,
  ReactExecutionPhase,
  ReactFormActionStatus,
  ReactFormStatusTopologyStatus,
  ReactHookStateUpdaterStatus,
  ReactIdentityStability,
  ReactImperativeHandleRefKind,
  ReactImperativeHandleStatus,
  ReactLazyDeclarationStatus,
  ReactLazyLoaderStatus,
  ReactOptimisticActionStatus,
  ReactOptimisticReducerStatus,
  ReactObligationStatus,
  ReactReducerDispatchKind,
  ReactReducerDispatchStatus,
  ReactReducerPurityStatus,
  ReactReducerReturnStatus,
  ReactRenderFailureKind,
  ReactSemanticCallbackKind,
  ReactSemanticEdgeKind,
  ReactSemanticRenderKind,
  ReactSuspenseCoverageStatus,
  ReactTransitionActionStatus,
  ReactUnitKind,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactSemanticActionState,
  ReactSemanticActionStateDispatch,
  ReactSemanticCallback,
  ReactSemanticAsyncTask,
  ReactSemanticContext,
  ReactSemanticContextConsumer,
  ReactSemanticContextProvider,
  ReactSemanticEdge,
  ReactSemanticEffect,
  ReactSemanticEffectEvent,
  ReactSemanticErrorBoundary,
  ReactSemanticErrorBoundaryDefinition,
  ReactSemanticEventBinding,
  ReactSemanticCallbackPropAlternative,
  ReactSemanticCallbackPropFlow,
  ReactSemanticCallableRef,
  ReactSemanticClassConstruction,
  ReactSemanticClassLifecycle,
  ReactSemanticClassStateWrite,
  ReactSemanticClassStateTransition,
  ReactSemanticExternalStore,
  ReactSemanticFormAction,
  ReactSemanticForm,
  ReactSemanticFormStatus,
  ReactSemanticFunctionCall,
  ReactSemanticGraph,
  ReactSemanticHookCall,
  ReactSemanticHookStateTransition,
  ReactSemanticImperativeHandle,
  ReactSemanticImperativeHandleBinding,
  ReactSemanticImperativeHandleInvocation,
  ReactSemanticImperativeHandleMethod,
  ReactSemanticLazyComponent,
  ReactSemanticLazyRender,
  ReactSemanticOptimisticState,
  ReactSemanticOptimisticUpdate,
  ReactSemanticReducer,
  ReactSemanticReducerDispatch,
  ReactSemanticTransitionAction,
  ReactSemanticReachableFunction,
  ReactSemanticRender,
  ReactSemanticRenderFailure,
  ReactSemanticSlotFlow,
  ReactSemanticEffectResource,
  ReactSemanticScheduler,
  ReactSemanticSuspenseBoundary,
  ReactSemanticUnit,
  ReactUnitDescriptor,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import { collectExecutionCallbackIds } from "./utils/collect-execution-callback-ids.js";
import { getClassMethodDeclaration } from "./utils/get-class-method-declaration.js";
import { getStaticClassMethodDeclaration } from "./utils/get-static-class-method-declaration.js";
import { getContainingFunction } from "./utils/get-containing-function.js";
import { getJsxOpeningElementForAttribute } from "./utils/get-jsx-opening-element-for-attribute.js";
import { getJsxComponentTargetFunction } from "./utils/get-jsx-component-target-function.js";
import { isDeferredCallbackSynchronous } from "./utils/is-deferred-callback-synchronous.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";
import { isIntrinsicJsxElement } from "./utils/is-intrinsic-jsx-element.js";
import { isReactiveCaptureDeclared } from "./utils/is-reactive-capture-declared.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

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

interface FormActionGraphFacts extends CallbackGraphFacts {
  actions: ReadonlyArray<ReactSemanticFormAction>;
}

interface ActionStateDefinitionGraphFacts extends CallbackGraphFacts {
  callbacksByDispatcher: ReadonlyMap<ts.Symbol, ReactSemanticCallback>;
  states: ReadonlyArray<ReactSemanticActionState>;
}

interface ActionStateDispatchGraphFacts {
  dispatches: ReadonlyArray<ReactSemanticActionStateDispatch>;
}

interface HookStateTransitionGraphFacts extends CallbackGraphFacts {
  transitions: ReadonlyArray<ReactSemanticHookStateTransition>;
}

interface ReducerDefinitionGraphFacts extends CallbackGraphFacts {
  reducers: ReadonlyArray<ReactSemanticReducer>;
}

interface ReducerDispatchGraphFacts {
  dispatches: ReadonlyArray<ReactSemanticReducerDispatch>;
}

interface ImperativeHandleGraphFacts extends CallbackGraphFacts {
  handles: ReadonlyArray<ReactSemanticImperativeHandle>;
  methods: ReadonlyArray<ReactSemanticImperativeHandleMethod>;
  bindings: ReadonlyArray<ReactSemanticImperativeHandleBinding>;
  invocations: ReadonlyArray<ReactSemanticImperativeHandleInvocation>;
}

interface ImperativeHandleIdentity {
  descriptor: ImperativeHandleDescriptor;
  handleId: string;
  identity: UnitGraphIdentity;
  methods: ReadonlyArray<ImperativeHandleMethodIdentity>;
  methodsByName: ReadonlyMap<string, ImperativeHandleMethodIdentity>;
}

interface ImperativeHandleMethodIdentity {
  descriptor: ImperativeHandleMethodDescriptor;
  methodId: string;
}

interface ImperativeHandleBindingDescriptor {
  handleIdentity: ImperativeHandleIdentity;
  identity: UnitGraphIdentity;
  refAttribute: ts.JsxAttribute;
  refDeclaration: ts.VariableDeclaration;
  refName: string;
  refSymbol: ts.Symbol;
  render: ReactSemanticRender | null;
  sourceComplete: boolean;
}

interface ImperativeHandleInvocationDescriptor {
  binding: ImperativeHandleBindingDescriptor;
  callExpression: ts.CallExpression;
  method: ImperativeHandleMethodIdentity | null;
  callerCallbackIds: ReadonlyArray<string>;
  sourceComplete: boolean;
}

interface OptimisticStateGraphFacts extends CallbackGraphFacts {
  states: ReadonlyArray<ReactSemanticOptimisticState>;
  updates: ReadonlyArray<ReactSemanticOptimisticUpdate>;
}

interface TransitionActionGraphFacts extends CallbackGraphFacts {
  actions: ReadonlyArray<ReactSemanticTransitionAction>;
}

interface TransitionActionGraphIdentity {
  actionCallback: ReactSemanticCallback | null;
  actionId: string;
  descriptor: TransitionActionDescriptor;
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

interface FormTopologyGraphFacts {
  forms: ReadonlyArray<ReactSemanticForm>;
  formStatuses: ReadonlyArray<ReactSemanticFormStatus>;
  formsByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticForm>;
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
  errorBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>;
  renders: ReadonlyArray<ReactSemanticRender>;
  suspenseBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface RenderSlotBoundary {
  complete: boolean;
  containerRenderId: string | null;
  node: ts.Node;
  propName: string | null;
}

interface SlotGraphFacts {
  errorBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>;
  renders: ReadonlyArray<ReactSemanticRender>;
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>;
  suspenseBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface SuspenseGraphFacts {
  boundaries: ReadonlyArray<ReactSemanticSuspenseBoundary>;
  boundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticSuspenseBoundary>;
}

interface ErrorBoundaryDefinitionIdentity {
  definition: ReactSemanticErrorBoundaryDefinition;
  identity: UnitGraphIdentity;
}

interface ErrorBoundaryGraphFacts {
  boundaries: ReadonlyArray<ReactSemanticErrorBoundary>;
  boundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticErrorBoundary>;
  definitions: ReadonlyArray<ReactSemanticErrorBoundaryDefinition>;
  definitionsByUnitId: ReadonlyMap<string, ReactSemanticErrorBoundaryDefinition>;
}

interface RenderErrorGraphFacts {
  failures: ReadonlyArray<ReactSemanticRenderFailure>;
}

interface LazyComponentIdentity {
  component: ReactSemanticLazyComponent;
  declaration: ts.Node;
  symbol: ts.Symbol | null;
}

interface LazyGraphFacts {
  components: ReadonlyArray<ReactSemanticLazyComponent>;
  renders: ReadonlyArray<ReactSemanticLazyRender>;
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
  if (
    ts.isCallExpression(functionNode.parent) &&
    ts.isVariableDeclaration(functionNode.parent.parent)
  ) {
    return functionNode.parent.parent.name;
  }
  return functionNode;
};

const resolveAliasedSymbol = (symbol: ts.Symbol, typeChecker: ts.TypeChecker): ts.Symbol =>
  symbol.flags & ts.SymbolFlags.Alias ? typeChecker.getAliasedSymbol(symbol) : symbol;

const isDeclarationExported = (
  declaration: ts.Node,
  declarationSymbol: ts.Symbol | null,
  typeChecker: ts.TypeChecker,
): boolean => {
  let currentNode: ts.Node | undefined = declaration;
  while (currentNode && !ts.isSourceFile(currentNode)) {
    if (ts.isExportAssignment(currentNode) && !currentNode.isExportEquals) return true;
    if (
      ts.canHaveModifiers(currentNode) &&
      ts
        .getModifiers(currentNode)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return true;
    }
    currentNode = currentNode.parent;
  }
  const moduleSymbol = typeChecker.getSymbolAtLocation(declaration.getSourceFile());
  if (!declarationSymbol || !moduleSymbol) return false;
  const resolvedDeclarationSymbol = resolveAliasedSymbol(declarationSymbol, typeChecker);
  return typeChecker
    .getExportsOfModule(moduleSymbol)
    .some(
      (exportSymbol) =>
        resolveAliasedSymbol(exportSymbol, typeChecker) === resolvedDeclarationSymbol,
    );
};

const isDescriptorExported = (
  descriptor: ReactUnitDescriptor,
  typeChecker: ts.TypeChecker,
): boolean => {
  const declarationName = getDeclarationNameNode(descriptor);
  const declarationSymbol = declarationName
    ? (typeChecker.getSymbolAtLocation(declarationName) ?? null)
    : null;
  return isDeclarationExported(descriptor.node, declarationSymbol, typeChecker);
};

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
  stopNode: ts.Node | null = null,
): ReadonlyArray<string> => {
  const providerIds: string[] = [];
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode && currentNode !== stopNode && !isFunctionBoundary(currentNode)) {
    if (ts.isJsxElement(currentNode)) {
      const provider = providersByOpeningNode.get(currentNode.openingElement);
      if (provider) providerIds.unshift(provider.id);
    }
    currentNode = currentNode.parent;
  }
  return providerIds;
};

const collectFormTopologyGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  context: ReactAnalysisContext,
): FormTopologyGraphFacts => {
  const forms: ReactSemanticForm[] = [];
  const formStatuses: ReactSemanticFormStatus[] = [];
  const formsByOpeningNode = new Map<ts.JsxOpeningLikeElement, ReactSemanticForm>();
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const visit = (node: ts.Node): void => {
      if (node !== functionNode && isFunctionBoundary(node)) return;
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName) &&
        node.tagName.text === "form"
      ) {
        const form: ReactSemanticForm = {
          id: createSemanticId("form", "form", node.tagName, context),
          ownerId: identity.semanticUnit.id,
          location: getNodeLocation(node.tagName, context.rootDirectory),
        };
        forms.push(form);
        formsByOpeningNode.set(node, form);
      }
      if (
        ts.isCallExpression(node) &&
        getCanonicalReactApiName(node.expression, context.typeChecker) === "useFormStatus"
      ) {
        formStatuses.push({
          id: createSemanticId("form-status", "useFormStatus", node, context),
          ownerId: identity.semanticUnit.id,
          location: getNodeLocation(node, context.rootDirectory),
          sourceFormIds: [],
          outsideForm: false,
          status: ReactFormStatusTopologyStatus.Unknown,
          sourceComplete: false,
          complete: false,
        });
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }
  return { forms, formStatuses, formsByOpeningNode };
};

const collectActiveFormIds = (
  node: ts.Node,
  formsByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticForm>,
  stopNode: ts.Node | null = null,
): ReadonlyArray<string> => {
  const activeFormIds: string[] = [];
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode && currentNode !== stopNode && !isFunctionBoundary(currentNode)) {
    if (ts.isJsxElement(currentNode)) {
      const form = formsByOpeningNode.get(currentNode.openingElement);
      if (form) activeFormIds.unshift(form.id);
    }
    currentNode = currentNode.parent;
  }
  return activeFormIds;
};

const collectSuspenseGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  context: ReactAnalysisContext,
): SuspenseGraphFacts => {
  const boundaries: ReactSemanticSuspenseBoundary[] = [];
  const boundariesByOpeningNode = new Map<
    ts.JsxOpeningLikeElement,
    ReactSemanticSuspenseBoundary
  >();
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const visit = (node: ts.Node): void => {
      if (node !== functionNode && isFunctionBoundary(node)) return;
      const openingElement =
        ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
      if (
        openingElement &&
        !ts.isJsxNamespacedName(openingElement.tagName) &&
        getCanonicalReactApiName(openingElement.tagName, context.typeChecker) === "Suspense"
      ) {
        const boundary: ReactSemanticSuspenseBoundary = {
          id: createSemanticId("suspense-boundary", "Suspense", openingElement.tagName, context),
          ownerId: identity.semanticUnit.id,
          location: getNodeLocation(openingElement.tagName, context.rootDirectory),
          renderIds: [],
        };
        boundaries.push(boundary);
        boundariesByOpeningNode.set(openingElement, boundary);
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }
  return { boundaries, boundariesByOpeningNode };
};

const collectActiveSuspenseBoundaryIds = (
  node: ts.Node,
  boundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticSuspenseBoundary>,
  stopNode: ts.Node | null = null,
): ReadonlyArray<string> => {
  const boundaryIds: string[] = [];
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode && currentNode !== stopNode && !isFunctionBoundary(currentNode)) {
    if (ts.isJsxElement(currentNode)) {
      const boundary = boundariesByOpeningNode.get(currentNode.openingElement);
      const fallbackAttribute = currentNode.openingElement.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText() === "fallback",
      );
      if (boundary && !(fallbackAttribute && isNodeWithin(node, fallbackAttribute))) {
        boundaryIds.unshift(boundary.id);
      }
    }
    currentNode = currentNode.parent;
  }
  return boundaryIds;
};

const getContainingSuspenseFallbackElement = (
  node: ts.Node,
  boundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticSuspenseBoundary>,
): ts.JsxElement | null => {
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode && !isFunctionBoundary(currentNode)) {
    if (ts.isJsxAttribute(currentNode) && currentNode.name.getText() === "fallback") {
      const openingElement = getJsxOpeningElementForAttribute(currentNode);
      if (
        openingElement &&
        boundariesByOpeningNode.has(openingElement) &&
        ts.isJsxOpeningElement(openingElement) &&
        ts.isJsxElement(openingElement.parent)
      ) {
        return openingElement.parent;
      }
    }
    currentNode = currentNode.parent;
  }
  return null;
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

const collectErrorBoundaryGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  context: ReactAnalysisContext,
): ErrorBoundaryGraphFacts => {
  const definitionIdentities: ErrorBoundaryDefinitionIdentity[] = [];
  for (const identity of identities) {
    const classNode = identity.descriptor.classNode;
    const renderMethod =
      classNode && identity.descriptor.kind === ReactUnitKind.ClassComponent
        ? getClassMethodDeclaration(classNode, "render")
        : null;
    if (!classNode || !renderMethod) continue;
    const protocol = collectErrorBoundaryProtocol(classNode, renderMethod, context);
    if (!protocol.isCandidate) continue;
    const definition: ReactSemanticErrorBoundaryDefinition = {
      id: createSemanticId(
        "error-boundary-definition",
        identity.descriptor.name,
        classNode,
        context,
      ),
      ownerId: identity.semanticUnit.id,
      location: getNodeLocation(classNode, context.rootDirectory),
      derivedStateLocation: protocol.derivedStateMethod
        ? getNodeLocation(protocol.derivedStateMethod, context.rootDirectory)
        : null,
      componentDidCatchLocation: protocol.componentDidCatchMethod
        ? getNodeLocation(protocol.componentDidCatchMethod, context.rootDirectory)
        : null,
      fallbackStateKey: protocol.fallbackStateKey,
      derivedStateStatus: protocol.derivedStateStatus,
      fallbackRenderStatus: protocol.fallbackRenderStatus,
      instanceIds: [],
      sourceComplete: protocol.isSourceComplete,
      complete:
        protocol.isSourceComplete &&
        protocol.derivedStateStatus === ReactErrorBoundaryProtocolStatus.Valid &&
        protocol.fallbackRenderStatus === ReactErrorBoundaryProtocolStatus.Valid,
    };
    definitionIdentities.push({ definition, identity });
  }
  const definitionsByUnitId = new Map(
    definitionIdentities.map(({ definition }) => [definition.ownerId, definition]),
  );
  const boundaries: ReactSemanticErrorBoundary[] = [];
  const boundariesByOpeningNode = new Map<ts.JsxOpeningLikeElement, ReactSemanticErrorBoundary>();
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const visit = (node: ts.Node): void => {
      if (node !== functionNode && isFunctionBoundary(node)) return;
      const openingElement =
        ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
      if (openingElement && !ts.isJsxNamespacedName(openingElement.tagName)) {
        const targetId = resolveUnitTarget(
          openingElement.tagName,
          unitIdsBySymbol,
          context.typeChecker,
        );
        const definition = targetId ? definitionsByUnitId.get(targetId) : null;
        if (definition) {
          const boundary: ReactSemanticErrorBoundary = {
            id: createSemanticId("error-boundary", definition.id, openingElement.tagName, context),
            ownerId: identity.semanticUnit.id,
            definitionId: definition.id,
            location: getNodeLocation(openingElement.tagName, context.rootDirectory),
            renderIds: [],
          };
          boundaries.push(boundary);
          boundariesByOpeningNode.set(openingElement, boundary);
        }
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }
  const instanceIdsByDefinitionId = new Map<string, string[]>();
  for (const boundary of boundaries) {
    const instanceIds = instanceIdsByDefinitionId.get(boundary.definitionId) ?? [];
    instanceIds.push(boundary.id);
    instanceIdsByDefinitionId.set(boundary.definitionId, instanceIds);
  }
  const definitions = definitionIdentities.map(({ definition }) => ({
    ...definition,
    instanceIds: instanceIdsByDefinitionId.get(definition.id) ?? [],
  }));
  return {
    boundaries,
    boundariesByOpeningNode,
    definitions,
    definitionsByUnitId: new Map(definitions.map((definition) => [definition.ownerId, definition])),
  };
};

const collectActiveErrorBoundaryIds = (
  node: ts.Node,
  boundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticErrorBoundary>,
  stopNode: ts.Node | null = null,
): ReadonlyArray<string> => {
  const boundaryIds: string[] = [];
  const originOpeningElement =
    ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent)
      ? node.parent
      : null;
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode && currentNode !== stopNode && !isFunctionBoundary(currentNode)) {
    if (ts.isJsxElement(currentNode)) {
      const boundary = boundariesByOpeningNode.get(currentNode.openingElement);
      if (boundary && currentNode.openingElement !== originOpeningElement) {
        boundaryIds.unshift(boundary.id);
      }
    }
    currentNode = currentNode.parent;
  }
  return boundaryIds;
};

const isTransparentSlotOpening = (
  openingElement: ts.JsxOpeningLikeElement,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (isIntrinsicJsxElement(openingElement) || providersByOpeningNode.has(openingElement)) {
    return true;
  }
  const reactComponentName = ts.isJsxNamespacedName(openingElement.tagName)
    ? null
    : getCanonicalReactApiName(openingElement.tagName, typeChecker);
  return Boolean(reactComponentName && REACT_TRANSPARENT_COMPONENT_NAMES.has(reactComponentName));
};

const getContainingRenderSlotBoundary = (
  tagName: ts.JsxTagNameExpression,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
  context: ReactAnalysisContext,
): RenderSlotBoundary | null => {
  const ownOpeningElement = tagName.parent;
  let complete = true;
  let currentNode: ts.Node =
    ts.isJsxOpeningElement(ownOpeningElement) && ts.isJsxElement(ownOpeningElement.parent)
      ? ownOpeningElement.parent
      : ownOpeningElement;
  while (!ts.isSourceFile(currentNode) && !isFunctionBoundary(currentNode)) {
    const parentNode = currentNode.parent;
    if (!parentNode) break;
    let openingElement: ts.JsxOpeningLikeElement | null = null;
    let propName: string | null = null;
    if (ts.isJsxAttribute(parentNode)) {
      openingElement = getJsxOpeningElementForAttribute(parentNode);
      propName = parentNode.name.getText();
    } else if (ts.isJsxSpreadAttribute(parentNode)) {
      openingElement =
        ts.isJsxOpeningElement(parentNode.parent) || ts.isJsxSelfClosingElement(parentNode.parent)
          ? parentNode.parent
          : null;
      complete = false;
    } else if (ts.isJsxElement(parentNode)) {
      openingElement = parentNode.openingElement;
      propName = "children";
    }
    if (
      openingElement &&
      !isTransparentSlotOpening(openingElement, providersByOpeningNode, context.typeChecker)
    ) {
      const targetId = resolveUnitTarget(
        openingElement.tagName,
        unitIdsBySymbol,
        context.typeChecker,
      );
      return {
        complete,
        containerRenderId: targetId
          ? createSemanticId("render", targetId, openingElement.tagName, context)
          : null,
        node: openingElement,
        propName,
      };
    }
    if (openingElement && propName !== null && propName !== "children") {
      complete = false;
    }
    if (
      ts.isCallExpression(parentNode) &&
      !(
        getCanonicalReactApiName(parentNode.expression, context.typeChecker) === "createPortal" &&
        parentNode.arguments[0] === currentNode
      )
    ) {
      complete = false;
    } else if (ts.isConditionalExpression(parentNode) && parentNode.condition === currentNode) {
      complete = false;
    } else if (ts.isBinaryExpression(parentNode)) {
      const operatorKind = parentNode.operatorToken.kind;
      if (
        parentNode.right !== currentNode ||
        (operatorKind !== ts.SyntaxKind.AmpersandAmpersandToken &&
          operatorKind !== ts.SyntaxKind.BarBarToken &&
          operatorKind !== ts.SyntaxKind.QuestionQuestionToken)
      ) {
        complete = false;
      }
    } else if (
      ts.isVariableDeclaration(parentNode) ||
      ts.isPropertyAssignment(parentNode) ||
      ts.isShorthandPropertyAssignment(parentNode) ||
      ts.isElementAccessExpression(parentNode) ||
      ts.isPropertyAccessExpression(parentNode) ||
      ts.isExpressionStatement(parentNode)
    ) {
      complete = false;
    }
    if (
      (ts.isReturnStatement(parentNode) && parentNode.expression === currentNode) ||
      (ts.isArrowFunction(parentNode) && parentNode.body === currentNode)
    ) {
      return complete
        ? null
        : {
            complete: false,
            containerRenderId: null,
            node: currentNode,
            propName: null,
          };
    }
    currentNode = parentNode;
  }
  return {
    complete: false,
    containerRenderId: null,
    node: currentNode,
    propName: null,
  };
};

const collectRenderEdges = (
  identity: UnitGraphIdentity,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
  formsByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticForm>,
  errorBoundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticErrorBoundary>,
  suspenseBoundariesByOpeningNode: ReadonlyMap<
    ts.JsxOpeningLikeElement,
    ReactSemanticSuspenseBoundary
  >,
  context: ReactAnalysisContext,
): RenderGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode) {
    return {
      edges: [],
      errorBoundaryIdsByRenderId: new Map(),
      renders: [],
      suspenseBoundaryIdsByRenderId: new Map(),
    };
  }
  const edges: ReactSemanticEdge[] = [];
  const renders: ReactSemanticRender[] = [];
  const errorBoundaryIdsByRenderId = new Map<string, ReadonlyArray<string>>();
  const suspenseBoundaryIdsByRenderId = new Map<string, ReadonlyArray<string>>();
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      return;
    }
    const openingElement =
      ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
    const tagName = openingElement?.tagName ?? null;
    if (tagName && openingElement && !isIntrinsicJsxElement(openingElement)) {
      const targetId = resolveUnitTarget(tagName, unitIdsBySymbol, context.typeChecker);
      if (targetId) {
        const location = getNodeLocation(tagName, context.rootDirectory);
        const slotBoundary = getContainingRenderSlotBoundary(
          tagName,
          unitIdsBySymbol,
          providersByOpeningNode,
          context,
        );
        const topologyKind = slotBoundary
          ? ReactSemanticRenderKind.SlotInput
          : ReactSemanticRenderKind.Direct;
        edges.push({
          kind: ReactSemanticEdgeKind.RendersComponent,
          sourceId: identity.semanticUnit.id,
          targetId,
          location,
        });
        const renderId = createSemanticId("render", targetId, tagName, context);
        renders.push({
          id: renderId,
          ownerId: identity.semanticUnit.id,
          targetId,
          location,
          kind: topologyKind,
          sourceRenderId: null,
          containerRenderId: slotBoundary?.containerRenderId ?? null,
          slotPropName: slotBoundary?.propName ?? null,
          topologyOwnerIds: [identity.semanticUnit.id],
          activeContextProviderIds: collectActiveContextProviderIds(
            tagName,
            providersByOpeningNode,
            slotBoundary?.node ?? null,
          ),
          contextTopologyComplete: slotBoundary?.complete ?? true,
          activeFormIds: collectActiveFormIds(
            tagName,
            formsByOpeningNode,
            slotBoundary?.node ?? null,
          ),
          formTopologyComplete: slotBoundary?.complete ?? true,
        });
        suspenseBoundaryIdsByRenderId.set(
          renderId,
          collectActiveSuspenseBoundaryIds(
            tagName,
            suspenseBoundariesByOpeningNode,
            slotBoundary?.node ?? null,
          ),
        );
        errorBoundaryIdsByRenderId.set(
          renderId,
          collectActiveErrorBoundaryIds(
            tagName,
            errorBoundariesByOpeningNode,
            slotBoundary?.node ?? null,
          ),
        );
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return {
    edges,
    errorBoundaryIdsByRenderId,
    renders,
    suspenseBoundaryIdsByRenderId,
  };
};

const collectSlotGraph = (
  renders: ReadonlyArray<ReactSemanticRender>,
  errorBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>,
  suspenseBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>,
  identitiesByFunction: ReadonlyMap<ts.FunctionLikeDeclaration, UnitGraphIdentity>,
  slotFlow: ComponentSlotFlowDescriptor,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
  formsByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticForm>,
  errorBoundariesByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticErrorBoundary>,
  suspenseBoundariesByOpeningNode: ReadonlyMap<
    ts.JsxOpeningLikeElement,
    ReactSemanticSuspenseBoundary
  >,
  context: ReactAnalysisContext,
): SlotGraphFacts => {
  const rendersById = new Map(renders.map((render) => [render.id, render]));
  const identitiesByUnitId = new Map(
    [...identitiesByFunction.values()].map((identity) => [identity.semanticUnit.id, identity]),
  );
  const resolvedRenders: ReactSemanticRender[] = [];
  const slotRenders: ReactSemanticRender[] = [];
  const slotFlows: ReactSemanticSlotFlow[] = [];
  const resolvedSuspenseBoundaryIdsByRenderId = new Map(suspenseBoundaryIdsByRenderId);
  const resolvedErrorBoundaryIdsByRenderId = new Map(errorBoundaryIdsByRenderId);
  for (const render of renders) {
    if (render.kind !== ReactSemanticRenderKind.SlotInput) {
      resolvedRenders.push(render);
      continue;
    }
    const containerRender = render.containerRenderId
      ? rendersById.get(render.containerRenderId)
      : null;
    const containerIdentity = containerRender
      ? identitiesByUnitId.get(containerRender.targetId)
      : null;
    const containerFunction = containerIdentity?.descriptor.functionNode ?? null;
    const resolution =
      containerFunction && render.slotPropName
        ? slotFlow.resolveSlot(containerFunction, render.slotPropName)
        : { complete: false, placements: [] };
    const sourceComplete = render.contextTopologyComplete;
    const placementComplete = resolution.complete;
    let complete = sourceComplete && placementComplete;
    const renderIds: string[] = [];
    for (const placement of resolution.placements) {
      const placementIdentities = placement.topologyFrames.map((topologyFrame) =>
        identitiesByFunction.get(topologyFrame.ownerFunction),
      );
      const placementIdentity = placementIdentities.at(-1);
      if (!placementIdentity || placementIdentities.some((identity) => !identity)) {
        complete = false;
        continue;
      }
      const topologyPathIdentity = placement.topologyFrames
        .map((topologyFrame) => {
          const location = getNodeLocation(topologyFrame.node, context.rootDirectory);
          return `${location.filePath}:${location.line}:${location.column}`;
        })
        .join(">");
      const slotRender: ReactSemanticRender = {
        id: createSemanticId(
          "slot-render",
          `${render.id}:${topologyPathIdentity}`,
          placement.node,
          context,
        ),
        ownerId: placementIdentity.semanticUnit.id,
        targetId: render.targetId,
        location: getNodeLocation(placement.node, context.rootDirectory),
        kind: ReactSemanticRenderKind.Slot,
        sourceRenderId: render.id,
        containerRenderId: render.containerRenderId,
        slotPropName: render.slotPropName,
        topologyOwnerIds: [
          ...new Set([
            ...placementIdentities.flatMap((identity) =>
              identity ? [identity.semanticUnit.id] : [],
            ),
            render.ownerId,
          ]),
        ],
        activeContextProviderIds: [
          ...new Set([
            ...placement.topologyFrames.flatMap((topologyFrame) =>
              collectActiveContextProviderIds(topologyFrame.node, providersByOpeningNode),
            ),
            ...render.activeContextProviderIds,
          ]),
        ],
        contextTopologyComplete: true,
        activeFormIds: [
          ...new Set([
            ...placement.topologyFrames.flatMap((topologyFrame) =>
              collectActiveFormIds(topologyFrame.node, formsByOpeningNode),
            ),
            ...render.activeFormIds,
          ]),
        ],
        formTopologyComplete: true,
      };
      slotRenders.push(slotRender);
      renderIds.push(slotRender.id);
      resolvedSuspenseBoundaryIdsByRenderId.set(slotRender.id, [
        ...new Set([
          ...(suspenseBoundaryIdsByRenderId.get(render.id) ?? []),
          ...placement.topologyFrames.flatMap((topologyFrame) =>
            collectActiveSuspenseBoundaryIds(topologyFrame.node, suspenseBoundariesByOpeningNode),
          ),
        ]),
      ]);
      resolvedErrorBoundaryIdsByRenderId.set(slotRender.id, [
        ...new Set([
          ...(errorBoundaryIdsByRenderId.get(render.id) ?? []),
          ...placement.topologyFrames.flatMap((topologyFrame) =>
            collectActiveErrorBoundaryIds(topologyFrame.node, errorBoundariesByOpeningNode),
          ),
        ]),
      ]);
    }
    resolvedRenders.push({
      ...render,
      contextTopologyComplete: complete,
      formTopologyComplete: complete,
    });
    slotFlows.push({
      id: `${render.id}:slot-flow:${render.slotPropName ?? "unknown"}`,
      ownerId: render.ownerId,
      sourceRenderId: render.id,
      containerRenderId: render.containerRenderId,
      propName: render.slotPropName,
      renderIds,
      location: render.location,
      sourceComplete,
      placementComplete,
      complete,
    });
  }
  return {
    errorBoundaryIdsByRenderId: resolvedErrorBoundaryIdsByRenderId,
    renders: [...resolvedRenders, ...slotRenders],
    slotFlows,
    suspenseBoundaryIdsByRenderId: resolvedSuspenseBoundaryIdsByRenderId,
  };
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

const getHookDependencyFacts = (
  hookCall: ts.CallExpression,
  argumentIndex: number,
): { mode: ReactEffectDependencyMode; dependencies: ReadonlyArray<string> } => {
  const dependencyExpression = hookCall.arguments[argumentIndex];
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
    const dependencyFacts = getHookDependencyFacts(effectCall, 1);
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
  const componentDidCatchMethod = getClassMethodDeclaration(classNode, "componentDidCatch");
  const derivedStateFromErrorMethod = getStaticClassMethodDeclaration(
    classNode,
    "getDerivedStateFromError",
  );
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
    ...(componentDidCatchMethod ? [componentDidCatchMethod] : []),
    ...(derivedStateFromErrorMethod ? [derivedStateFromErrorMethod] : []),
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

const getReducerPurityStatus = (
  functionNode: ts.FunctionLikeDeclaration | null,
  context: ReactAnalysisContext,
): ReactReducerPurityStatus => {
  if (!functionNode) return ReactReducerPurityStatus.Opaque;
  const purityProof = analyzeRenderPurity(functionNode, context);
  if (purityProof.status === ReactObligationStatus.Violated) {
    return ReactReducerPurityStatus.Impure;
  }
  return purityProof.status === ReactObligationStatus.Proved
    ? ReactReducerPurityStatus.Pure
    : ReactReducerPurityStatus.Opaque;
};

const getReducerReturnStatus = (
  functionNode: ts.FunctionLikeDeclaration | null,
  isAbsent: boolean,
  context: ReactAnalysisContext,
): ReactReducerReturnStatus => {
  if (isAbsent) return ReactReducerReturnStatus.Absent;
  if (!functionNode) return ReactReducerReturnStatus.Opaque;
  const returnSummary = summarizeFunctionReturns(functionNode, context.typeChecker);
  if (returnSummary.canFallThrough) return ReactReducerReturnStatus.MayFallThrough;
  if (returnSummary.canThrow) return ReactReducerReturnStatus.MayThrow;
  return returnSummary.isComplete
    ? ReactReducerReturnStatus.Total
    : ReactReducerReturnStatus.Opaque;
};

const collectReducerDefinitionGraph = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): ReducerDefinitionGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (
    !functionNode ||
    identity.descriptor.kind === ReactUnitKind.ClassComponent ||
    identity.descriptor.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return {
      reducers: [],
      callbacks: [],
      reachableFunctions: [],
      functionCalls: [],
    };
  }
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
    ...hookBindings.transitionStarters,
  ]);
  const createReducerCallback = (
    reducerId: string,
    callbackFunction: ts.FunctionLikeDeclaration | null,
    kind: ReactSemanticCallbackKind,
    name: string,
  ): ReactSemanticCallback | null => {
    if (!callbackFunction) return null;
    const callback = {
      ...createCallbackFact(
        identity,
        callbackFunction,
        functionNode,
        stableSymbols,
        kind,
        ReactExecutionPhase.StateTransition,
        name,
        context,
      ),
      id: createSemanticId(`${kind}:${reducerId}`, name, callbackFunction, context),
    };
    callbacks.push(callback);
    const reachabilityFacts = collectReachabilityGraphFacts(
      identity,
      callbackFunction,
      callback,
      context,
    );
    reachableFunctions.push(...reachabilityFacts.reachableFunctions);
    functionCalls.push(...reachabilityFacts.functionCalls);
    return callback;
  };
  const reducers = collectReducerTransitions(functionNode, context).reducers.map(
    (descriptor): ReactSemanticReducer => {
      const reducerId = createSemanticId(
        "reducer",
        descriptor.dispatcherSymbol?.getName() ?? descriptor.stateSymbol?.getName() ?? "useReducer",
        descriptor.callExpression,
        context,
      );
      const reducerCallback = createReducerCallback(
        reducerId,
        descriptor.reducerFunction,
        ReactSemanticCallbackKind.Reducer,
        "reducer",
      );
      const initializerCallback = createReducerCallback(
        reducerId,
        descriptor.initializerFunction,
        ReactSemanticCallbackKind.ReducerInitializer,
        "reducer-initializer",
      );
      const reducerPurity = getReducerPurityStatus(descriptor.reducerFunction, context);
      const initializerPurity = descriptor.initializerProvided
        ? getReducerPurityStatus(descriptor.initializerFunction, context)
        : ReactReducerPurityStatus.Pure;
      const reducerReturnStatus = getReducerReturnStatus(
        descriptor.reducerFunction,
        false,
        context,
      );
      const initializerReturnStatus = getReducerReturnStatus(
        descriptor.initializerFunction,
        !descriptor.initializerProvided,
        context,
      );
      const sourceComplete =
        Boolean(reducerCallback) &&
        reducerPurity !== ReactReducerPurityStatus.Opaque &&
        reducerReturnStatus !== ReactReducerReturnStatus.Opaque &&
        (!descriptor.initializerProvided ||
          (Boolean(initializerCallback) &&
            initializerPurity !== ReactReducerPurityStatus.Opaque &&
            initializerReturnStatus !== ReactReducerReturnStatus.Opaque));
      const complete =
        sourceComplete &&
        reducerPurity === ReactReducerPurityStatus.Pure &&
        initializerPurity === ReactReducerPurityStatus.Pure &&
        reducerReturnStatus === ReactReducerReturnStatus.Total &&
        (initializerReturnStatus === ReactReducerReturnStatus.Absent ||
          initializerReturnStatus === ReactReducerReturnStatus.Total);
      return {
        id: reducerId,
        ownerId: identity.semanticUnit.id,
        stateName: descriptor.stateSymbol?.getName() ?? "unused reducer state",
        dispatcherName: descriptor.dispatcherSymbol?.getName() ?? "unused reducer dispatcher",
        location: getNodeLocation(descriptor.callExpression, context.rootDirectory),
        reducerCallbackId: reducerCallback?.id ?? null,
        initializerCallbackId: initializerCallback?.id ?? null,
        reducerPurity,
        initializerPurity,
        reducerReturnStatus,
        initializerReturnStatus,
        sourceComplete,
        complete,
      };
    },
  );
  return { reducers, callbacks, reachableFunctions, functionCalls };
};

const collectReducerDispatchGraph = (
  identity: UnitGraphIdentity,
  existingReducers: ReadonlyArray<ReactSemanticReducer>,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
  existingReachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>,
  context: ReactAnalysisContext,
): ReducerDispatchGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (
    !functionNode ||
    identity.descriptor.kind === ReactUnitKind.ClassComponent ||
    identity.descriptor.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return { dispatches: [] };
  }
  const callbacksById = new Map(existingCallbacks.map((callback) => [callback.id, callback]));
  const collection = collectReducerTransitions(functionNode, context);
  const reducersByCall = new Map(
    collection.reducers.flatMap(
      (descriptor): ReadonlyArray<[ts.CallExpression, ReactSemanticReducer]> => {
        const reducerId = createSemanticId(
          "reducer",
          descriptor.dispatcherSymbol?.getName() ??
            descriptor.stateSymbol?.getName() ??
            "useReducer",
          descriptor.callExpression,
          context,
        );
        const reducer = existingReducers.find((candidate) => candidate.id === reducerId);
        return reducer ? [[descriptor.callExpression, reducer]] : [];
      },
    ),
  );
  const dispatches = collection.dispatches.map((descriptor): ReactSemanticReducerDispatch => {
    const reducer = reducersByCall.get(descriptor.binding.callExpression);
    const executionCallbackIds = descriptor.callExpression
      ? collectExecutionCallbackIds({
          callbacks: existingCallbacks,
          evidenceNode: descriptor.callExpression,
          ownerId: identity.semanticUnit.id,
          reachableFunctions: existingReachableFunctions,
          rootDirectory: context.rootDirectory,
        })
      : [];
    const executionCallbacks = executionCallbackIds.flatMap((callbackId) => {
      const callback = callbacksById.get(callbackId);
      return callback ? [callback] : [];
    });
    let status = ReactReducerDispatchStatus.Unknown;
    if (!descriptor.callExpression) {
      status = ReactReducerDispatchStatus.Escape;
    } else if (
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Render)
    ) {
      status = ReactReducerDispatchStatus.Render;
    } else if (
      executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.StateTransition)
    ) {
      status = ReactReducerDispatchStatus.Reducer;
    } else if (executionCallbacks.length > 0) {
      status = ReactReducerDispatchStatus.Owned;
    }
    const sourceComplete =
      Boolean(reducer?.complete) &&
      status !== ReactReducerDispatchStatus.Escape &&
      status !== ReactReducerDispatchStatus.Unknown;
    return {
      id: createSemanticId(
        "reducer-dispatch",
        descriptor.binding.dispatcherSymbol.getName(),
        descriptor.evidenceNode,
        context,
      ),
      ownerId: identity.semanticUnit.id,
      reducerId: reducer?.id ?? "",
      kind: descriptor.callExpression
        ? ReactReducerDispatchKind.Call
        : ReactReducerDispatchKind.Escape,
      location: getNodeLocation(descriptor.evidenceNode, context.rootDirectory),
      executionCallbackIds,
      status,
      sourceComplete,
      complete: sourceComplete && status === ReactReducerDispatchStatus.Owned,
    };
  });
  return { dispatches };
};

const collectActionStateDefinitionGraph = (
  identity: UnitGraphIdentity,
  context: ReactAnalysisContext,
): ActionStateDefinitionGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (
    !functionNode ||
    identity.descriptor.kind === ReactUnitKind.ClassComponent ||
    identity.descriptor.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return {
      states: [],
      callbacksByDispatcher: new Map(),
      callbacks: [],
      reachableFunctions: [],
      functionCalls: [],
    };
  }
  const collection = collectActionState(functionNode, context);
  const callbacks: ReactSemanticCallback[] = [];
  const callbacksByDispatcher = new Map<ts.Symbol, ReactSemanticCallback>();
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
    ...hookBindings.transitionStarters,
  ]);
  const states = collection.states.map((descriptor): ReactSemanticActionState => {
    const stateId = createSemanticId(
      "action-state",
      descriptor.binding.dispatcherSymbol?.getName() ??
        descriptor.binding.stateSymbol?.getName() ??
        "useActionState",
      descriptor.binding.callExpression,
      context,
    );
    const reducerCallback = descriptor.reducerFunction
      ? {
          ...createCallbackFact(
            identity,
            descriptor.reducerFunction,
            functionNode,
            stableSymbols,
            ReactSemanticCallbackKind.ActionStateReducer,
            ReactExecutionPhase.ActionStateReducer,
            "action-state-reducer",
            context,
          ),
          id: createSemanticId(
            `action-state-reducer:${stateId}`,
            "reducer",
            descriptor.reducerFunction,
            context,
          ),
        }
      : null;
    if (reducerCallback && descriptor.reducerFunction) {
      callbacks.push(reducerCallback);
      if (descriptor.binding.dispatcherSymbol) {
        callbacksByDispatcher.set(descriptor.binding.dispatcherSymbol, reducerCallback);
      }
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        descriptor.reducerFunction,
        reducerCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const reducerStatus = reducerCallback
      ? ReactActionStateReducerStatus.Resolved
      : ReactActionStateReducerStatus.Opaque;
    const sourceComplete = Boolean(reducerCallback);
    return {
      id: stateId,
      ownerId: identity.semanticUnit.id,
      stateName: descriptor.binding.stateSymbol?.getName() ?? "unused Action State",
      dispatcherName:
        descriptor.binding.dispatcherSymbol?.getName() ?? "unused Action State dispatcher",
      location: getNodeLocation(descriptor.binding.callExpression, context.rootDirectory),
      reducerCallbackId: reducerCallback?.id ?? null,
      reducerStatus,
      sourceComplete,
      complete: sourceComplete,
    };
  });
  return { states, callbacksByDispatcher, callbacks, reachableFunctions, functionCalls };
};

const collectFormActionGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  context: ReactAnalysisContext,
  componentFlow: ComponentCallbackFlowDescriptor,
  actionStateCallbacksByDispatcher: ReadonlyMap<ts.Symbol, ReactSemanticCallback>,
): FormActionGraphFacts => {
  const identitiesByFunction = new Map(
    identities.flatMap(
      (identity): ReadonlyArray<[ts.FunctionLikeDeclaration, UnitGraphIdentity]> =>
        identity.descriptor.functionNode ? [[identity.descriptor.functionNode, identity]] : [],
    ),
  );
  const actions: ReactSemanticFormAction[] = [];
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    for (const descriptor of collectFormActions(identity.descriptor, context.typeChecker)) {
      const actionId = createSemanticId(
        "form-action",
        descriptor.propertyName,
        descriptor.evidenceNode,
        context,
      );
      const resolution = descriptor.isSpread
        ? componentFlow.resolveProperty(
            descriptor.actionExpression,
            descriptor.propertyName,
            functionNode,
            ReactExecutionPhase.FormAction,
          )
        : componentFlow.resolveExpression(
            descriptor.actionExpression,
            functionNode,
            ReactExecutionPhase.FormAction,
          );
      const dispatcherSymbol = descriptor.isSpread
        ? null
        : getResolvedSymbol(
            unwrapTypescriptExpression(descriptor.actionExpression),
            context.typeChecker,
          );
      const actionStateCallback = dispatcherSymbol
        ? actionStateCallbacksByDispatcher.get(dispatcherSymbol)
        : undefined;
      const actionCallbackIds: string[] = actionStateCallback ? [actionStateCallback.id] : [];
      for (const callbackDescriptor of resolution.callbacks) {
        const callbackIdentity = identitiesByFunction.get(callbackDescriptor.ownerFunction);
        if (!callbackIdentity) continue;
        const hookBindings = collectHookBindings(
          callbackDescriptor.ownerFunction,
          context.typeChecker,
        );
        const callbackFact = {
          ...createCallbackFact(
            callbackIdentity,
            callbackDescriptor.callbackFunction,
            callbackDescriptor.ownerFunction,
            new Set([
              ...hookBindings.refs,
              ...hookBindings.stateSetters,
              ...hookBindings.transitionStarters,
            ]),
            ReactSemanticCallbackKind.FormAction,
            ReactExecutionPhase.FormAction,
            descriptor.propertyName,
            context,
          ),
          id: createSemanticId(
            `form-action-callback:${actionId}`,
            getFunctionName(callbackDescriptor.callbackFunction) ?? descriptor.propertyName,
            callbackDescriptor.callbackFunction,
            context,
          ),
        };
        callbacks.push(callbackFact);
        actionCallbackIds.push(callbackFact.id);
        const reachabilityFacts = collectReachabilityGraphFacts(
          callbackIdentity,
          callbackDescriptor.callbackFunction,
          callbackFact,
          context,
          callbackDescriptor.bindings,
        );
        reachableFunctions.push(...reachabilityFacts.reachableFunctions);
        functionCalls.push(...reachabilityFacts.functionCalls);
      }
      const callbackComplete =
        Boolean(actionStateCallback) ||
        (resolution.isComplete &&
          actionCallbackIds.length > 0 &&
          actionCallbackIds.length === resolution.callbacks.length);
      let status = descriptor.status;
      if (status === ReactFormActionStatus.Resolved && !callbackComplete) {
        status = ReactFormActionStatus.Opaque;
      }
      const sourceComplete = callbackComplete && status !== ReactFormActionStatus.Opaque;
      actions.push({
        id: actionId,
        ownerId: identity.semanticUnit.id,
        kind: descriptor.kind,
        propName: descriptor.propertyName,
        location: getNodeLocation(descriptor.evidenceNode, context.rootDirectory),
        actionCallbackIds,
        status,
        callbackComplete,
        sourceComplete,
        complete: sourceComplete && status === ReactFormActionStatus.Resolved,
      });
    }
  }
  return { actions, callbacks, reachableFunctions, functionCalls };
};

const collectTransitionActionGraph = (
  identity: UnitGraphIdentity,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
  existingReachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>,
  context: ReactAnalysisContext,
): TransitionActionGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (!functionNode || identity.descriptor.kind === ReactUnitKind.InvalidHookOwner) {
    return { actions: [], callbacks: [], reachableFunctions: [], functionCalls: [] };
  }
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const stableSymbols = new Set([
    ...hookBindings.refs,
    ...hookBindings.stateSetters,
    ...hookBindings.transitionStarters,
  ]);
  const actionIdentities: TransitionActionGraphIdentity[] = collectTransitionActions(
    identity.descriptor,
    context,
  ).map((descriptor) => {
    const actionId = createSemanticId(
      "transition-action",
      descriptor.starterKind,
      descriptor.evidenceNode,
      context,
    );
    const actionCallback = descriptor.actionFunction
      ? {
          ...createCallbackFact(
            identity,
            descriptor.actionFunction,
            functionNode,
            stableSymbols,
            ReactSemanticCallbackKind.TransitionAction,
            ReactExecutionPhase.TransitionAction,
            "transition-action",
            context,
          ),
          id: createSemanticId(
            `transition-action-callback:${actionId}`,
            "action",
            descriptor.actionFunction,
            context,
          ),
        }
      : null;
    if (actionCallback && descriptor.actionFunction) {
      callbacks.push(actionCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        descriptor.actionFunction,
        actionCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    return { actionCallback, actionId, descriptor };
  });
  const allCallbacks = [...existingCallbacks, ...callbacks];
  const allReachableFunctions = [...existingReachableFunctions, ...reachableFunctions];
  const callbacksById = new Map(allCallbacks.map((callback) => [callback.id, callback]));
  const validOriginPhases = new Set([
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
  const actions = actionIdentities.map(
    ({ actionCallback, actionId, descriptor }): ReactSemanticTransitionAction => {
      const executionCallbackIds = collectExecutionCallbackIds({
        callbacks: allCallbacks,
        evidenceNode: descriptor.callExpression,
        ownerId: identity.semanticUnit.id,
        reachableFunctions: allReachableFunctions,
        rootDirectory: context.rootDirectory,
      });
      const hasValidExecutionRoot =
        executionCallbackIds.length > 0 &&
        executionCallbackIds.every((callbackId) => {
          const callback = callbacksById.get(callbackId);
          return Boolean(
            callback &&
            callback.ownerId === identity.semanticUnit.id &&
            validOriginPhases.has(callback.phase),
          );
        });
      const hasCompleteSourceStatus =
        descriptor.status === ReactTransitionActionStatus.Synchronous ||
        descriptor.status === ReactTransitionActionStatus.ControlledInput;
      const sourceComplete =
        hasValidExecutionRoot && Boolean(actionCallback) && hasCompleteSourceStatus;
      return {
        id: actionId,
        ownerId: identity.semanticUnit.id,
        starterKind: descriptor.starterKind,
        location: getNodeLocation(descriptor.evidenceNode, context.rootDirectory),
        executionCallbackIds,
        actionCallbackId: actionCallback?.id ?? null,
        controlledStateNames: descriptor.controlledStateNames,
        unknownControlStateNames: descriptor.unknownControlStateNames,
        status: descriptor.status,
        sourceComplete,
        complete: sourceComplete && descriptor.status === ReactTransitionActionStatus.Synchronous,
      };
    },
  );
  return { actions, callbacks, reachableFunctions, functionCalls };
};

const collectActionStateDispatchGraph = (
  identity: UnitGraphIdentity,
  existingStates: ReadonlyArray<ReactSemanticActionState>,
  existingFormActions: ReadonlyArray<ReactSemanticFormAction>,
  existingTransitionActions: ReadonlyArray<ReactSemanticTransitionAction>,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
  existingReachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>,
  context: ReactAnalysisContext,
): ActionStateDispatchGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (
    !functionNode ||
    identity.descriptor.kind === ReactUnitKind.ClassComponent ||
    identity.descriptor.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return { dispatches: [] };
  }
  const collection = collectActionState(functionNode, context);
  const callbacksById = new Map(existingCallbacks.map((callback) => [callback.id, callback]));
  const statesByDispatcher = new Map(
    collection.states.flatMap(
      (descriptor): ReadonlyArray<[ts.Symbol, ReactSemanticActionState]> => {
        const dispatcherSymbol = descriptor.binding.dispatcherSymbol;
        if (!dispatcherSymbol) return [];
        const stateId = createSemanticId(
          "action-state",
          dispatcherSymbol.getName(),
          descriptor.binding.callExpression,
          context,
        );
        const state = existingStates.find((candidate) => candidate.id === stateId);
        return state ? [[dispatcherSymbol, state]] : [];
      },
    ),
  );
  const completeTransitionCallbackIds = new Set(
    existingTransitionActions.flatMap((action) =>
      action.complete && action.actionCallbackId ? [action.actionCallbackId] : [],
    ),
  );
  return {
    dispatches: collection.dispatches.map((descriptor): ReactSemanticActionStateDispatch => {
      const actionState = statesByDispatcher.get(descriptor.binding.dispatcherSymbol);
      const dispatchId = createSemanticId(
        "action-state-dispatch",
        descriptor.binding.dispatcherSymbol.getName(),
        descriptor.evidenceNode,
        context,
      );
      const executionCallbackIds = descriptor.callExpression
        ? collectExecutionCallbackIds({
            callbacks: existingCallbacks,
            evidenceNode: descriptor.callExpression,
            ownerId: identity.semanticUnit.id,
            reachableFunctions: existingReachableFunctions,
            rootDirectory: context.rootDirectory,
          })
        : [];
      const executionCallbacks = executionCallbackIds.flatMap((callbackId) => {
        const callback = callbacksById.get(callbackId);
        return callback ? [callback] : [];
      });
      let status = ReactActionStateDispatchStatus.Unknown;
      if (!descriptor.callExpression && !descriptor.isActionPropReference) {
        status = ReactActionStateDispatchStatus.SetterEscape;
      } else if (descriptor.isActionPropReference) {
        const location = getNodeLocation(descriptor.evidenceNode, context.rootDirectory);
        const formAction = existingFormActions.find(
          (action) =>
            action.ownerId === identity.semanticUnit.id &&
            action.complete &&
            areProofLocationsEqual(action.location, location),
        );
        if (
          formAction &&
          actionState?.reducerCallbackId &&
          formAction.actionCallbackIds.includes(actionState.reducerCallbackId)
        ) {
          status = ReactActionStateDispatchStatus.Action;
        }
      } else if (
        executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Render)
      ) {
        status = ReactActionStateDispatchStatus.Render;
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
        status = ReactActionStateDispatchStatus.Action;
      } else if (
        executionCallbacks.some(
          (callback) =>
            callback.phase !== ReactExecutionPhase.FormAction &&
            callback.phase !== ReactExecutionPhase.ActionStateReducer &&
            callback.phase !== ReactExecutionPhase.TransitionAction,
        )
      ) {
        status = ReactActionStateDispatchStatus.OutsideAction;
      }
      const sourceComplete =
        Boolean(actionState?.complete) &&
        status !== ReactActionStateDispatchStatus.SetterEscape &&
        status !== ReactActionStateDispatchStatus.Unknown;
      let kind = ReactActionStateDispatchKind.Escape;
      if (descriptor.callExpression) {
        kind = ReactActionStateDispatchKind.Call;
      } else if (descriptor.isActionPropReference) {
        kind = ReactActionStateDispatchKind.ActionProp;
      }
      return {
        id: dispatchId,
        ownerId: identity.semanticUnit.id,
        actionStateId: actionState?.id ?? "",
        kind,
        location: getNodeLocation(descriptor.evidenceNode, context.rootDirectory),
        executionCallbackIds,
        status,
        sourceComplete,
        complete: sourceComplete && status === ReactActionStateDispatchStatus.Action,
      };
    }),
  };
};

const collectHookStateTransitionGraph = (
  identity: UnitGraphIdentity,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
  existingReachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>,
  context: ReactAnalysisContext,
): HookStateTransitionGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (
    !functionNode ||
    identity.descriptor.kind === ReactUnitKind.ClassComponent ||
    identity.descriptor.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return { transitions: [], callbacks: [], reachableFunctions: [], functionCalls: [] };
  }
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const existingCallbacksById = new Map(
    existingCallbacks.map((callback) => [callback.id, callback]),
  );
  const transitions = collectHookStateTransitions(functionNode, context).map((descriptor) => {
    const transitionId = createSemanticId(
      "hook-state-transition",
      descriptor.setterName,
      descriptor.evidenceNode,
      context,
    );
    const executionCallbackIds = collectExecutionCallbackIds({
      callbacks: existingCallbacks,
      evidenceNode: descriptor.callExpression,
      ownerId: identity.semanticUnit.id,
      reachableFunctions: existingReachableFunctions,
      rootDirectory: context.rootDirectory,
    });
    const updaterCallback = descriptor.updaterFunction
      ? createCallbackFact(
          identity,
          descriptor.updaterFunction,
          functionNode,
          new Set(),
          ReactSemanticCallbackKind.HookStateUpdater,
          ReactExecutionPhase.StateTransition,
          "hook-state-updater",
          context,
        )
      : null;
    const identifiedUpdaterCallback =
      updaterCallback && descriptor.updaterFunction
        ? {
            ...updaterCallback,
            id: createSemanticId(
              `hook-state-updater:${transitionId}`,
              "updater",
              descriptor.updaterFunction,
              context,
            ),
          }
        : null;
    if (identifiedUpdaterCallback && descriptor.updaterFunction) {
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
    const hasModeledExecutionRoot =
      executionCallbackIds.length > 0 &&
      executionCallbackIds.every(
        (callbackId) =>
          existingCallbacksById.get(callbackId)?.phase !== ReactExecutionPhase.StateTransition,
      );
    const sourceComplete =
      hasModeledExecutionRoot &&
      descriptor.updaterStatus !== ReactHookStateUpdaterStatus.SetterEscape &&
      descriptor.updaterStatus !== ReactHookStateUpdaterStatus.Unknown;
    return {
      id: transitionId,
      ownerId: identity.semanticUnit.id,
      stateName: descriptor.stateName,
      setterName: descriptor.setterName,
      location: getNodeLocation(descriptor.evidenceNode, context.rootDirectory),
      executionCallbackIds,
      updaterCallbackId: identifiedUpdaterCallback?.id ?? null,
      updaterStatus: descriptor.updaterStatus,
      sourceComplete,
      complete:
        sourceComplete &&
        (descriptor.updaterStatus === ReactHookStateUpdaterStatus.DirectValue ||
          descriptor.updaterStatus === ReactHookStateUpdaterStatus.Pure),
    };
  });
  return { transitions, callbacks, reachableFunctions, functionCalls };
};

const collectOptimisticStateGraph = (
  identity: UnitGraphIdentity,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
  existingReachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>,
  existingTransitionActions: ReadonlyArray<ReactSemanticTransitionAction>,
  context: ReactAnalysisContext,
): OptimisticStateGraphFacts => {
  const functionNode = identity.descriptor.functionNode;
  if (
    !functionNode ||
    identity.descriptor.kind === ReactUnitKind.ClassComponent ||
    identity.descriptor.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return {
      states: [],
      updates: [],
      callbacks: [],
      reachableFunctions: [],
      functionCalls: [],
    };
  }
  const collection = collectOptimisticState(functionNode, context);
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const stateIdsBySetter = new Map<ts.Symbol, string>();
  const states = collection.states.map((descriptor): ReactSemanticOptimisticState => {
    const stateId = createSemanticId(
      "optimistic-state",
      descriptor.binding.setterSymbol?.getName() ??
        descriptor.binding.stateSymbol?.getName() ??
        "useOptimistic",
      descriptor.binding.callExpression,
      context,
    );
    if (descriptor.binding.setterSymbol) {
      stateIdsBySetter.set(descriptor.binding.setterSymbol, stateId);
    }
    const reducerCallback = descriptor.reducerFunction
      ? {
          ...createCallbackFact(
            identity,
            descriptor.reducerFunction,
            functionNode,
            new Set(),
            ReactSemanticCallbackKind.OptimisticReducer,
            ReactExecutionPhase.OptimisticReducer,
            "optimistic-reducer",
            context,
          ),
          id: createSemanticId(
            `optimistic-reducer:${stateId}`,
            "reducer",
            descriptor.reducerFunction,
            context,
          ),
        }
      : null;
    if (reducerCallback && descriptor.reducerFunction) {
      callbacks.push(reducerCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        descriptor.reducerFunction,
        reducerCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const sourceComplete =
      descriptor.reducerStatus === ReactOptimisticReducerStatus.Absent ||
      ((descriptor.reducerStatus === ReactOptimisticReducerStatus.Pure ||
        descriptor.reducerStatus === ReactOptimisticReducerStatus.Impure) &&
        Boolean(reducerCallback));
    return {
      id: stateId,
      ownerId: identity.semanticUnit.id,
      stateName: descriptor.binding.stateSymbol?.getName() ?? "unused optimistic state",
      setterName: descriptor.binding.setterSymbol?.getName() ?? "unused optimistic setter",
      location: getNodeLocation(descriptor.binding.callExpression, context.rootDirectory),
      reducerCallbackId: reducerCallback?.id ?? null,
      reducerStatus: descriptor.reducerStatus,
      sourceComplete,
      complete:
        sourceComplete &&
        (descriptor.reducerStatus === ReactOptimisticReducerStatus.Absent ||
          descriptor.reducerStatus === ReactOptimisticReducerStatus.Pure),
    };
  });
  const rootCallbacks = [...existingCallbacks, ...callbacks];
  const rootReachableFunctions = [...existingReachableFunctions, ...reachableFunctions];
  const rootCallbacksById = new Map(rootCallbacks.map((callback) => [callback.id, callback]));
  const completeTransitionCallbackIds = new Set(
    existingTransitionActions.flatMap((action) =>
      action.complete && action.actionCallbackId ? [action.actionCallbackId] : [],
    ),
  );
  const updates = collection.updates.map((descriptor): ReactSemanticOptimisticUpdate => {
    const optimisticStateId =
      stateIdsBySetter.get(descriptor.binding.setterSymbol) ??
      createSemanticId(
        "optimistic-state",
        descriptor.binding.setterSymbol.getName(),
        descriptor.binding.callExpression,
        context,
      );
    const updateId = createSemanticId(
      "optimistic-update",
      descriptor.binding.setterSymbol.getName(),
      descriptor.evidenceNode,
      context,
    );
    const executionCallbackIds = collectExecutionCallbackIds({
      callbacks: rootCallbacks,
      evidenceNode: descriptor.callExpression,
      ownerId: identity.semanticUnit.id,
      reachableFunctions: rootReachableFunctions,
      rootDirectory: context.rootDirectory,
    });
    const executionCallbacks = executionCallbackIds.flatMap((callbackId) => {
      const callback = rootCallbacksById.get(callbackId);
      return callback ? [callback] : [];
    });
    let actionStatus = ReactOptimisticActionStatus.Unknown;
    if (executionCallbacks.some((callback) => callback.phase === ReactExecutionPhase.Render)) {
      actionStatus = ReactOptimisticActionStatus.Render;
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
      actionStatus = ReactOptimisticActionStatus.Action;
    } else if (
      executionCallbacks.some(
        (callback) =>
          callback.phase !== ReactExecutionPhase.FormAction &&
          callback.phase !== ReactExecutionPhase.ActionStateReducer &&
          callback.phase !== ReactExecutionPhase.TransitionAction,
      )
    ) {
      actionStatus = ReactOptimisticActionStatus.OutsideAction;
    }
    const updaterCallback = descriptor.updaterFunction
      ? {
          ...createCallbackFact(
            identity,
            descriptor.updaterFunction,
            functionNode,
            new Set(),
            ReactSemanticCallbackKind.OptimisticUpdater,
            ReactExecutionPhase.OptimisticUpdater,
            "optimistic-updater",
            context,
          ),
          id: createSemanticId(
            `optimistic-updater:${updateId}`,
            "updater",
            descriptor.updaterFunction,
            context,
          ),
        }
      : null;
    if (updaterCallback && descriptor.updaterFunction) {
      callbacks.push(updaterCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        identity,
        descriptor.updaterFunction,
        updaterCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const sourceComplete =
      actionStatus !== ReactOptimisticActionStatus.Unknown &&
      descriptor.updaterStatus !== ReactHookStateUpdaterStatus.SetterEscape &&
      descriptor.updaterStatus !== ReactHookStateUpdaterStatus.Unknown;
    return {
      id: updateId,
      ownerId: identity.semanticUnit.id,
      optimisticStateId,
      location: getNodeLocation(descriptor.evidenceNode, context.rootDirectory),
      executionCallbackIds,
      updaterCallbackId: updaterCallback?.id ?? null,
      updaterStatus: descriptor.updaterStatus,
      actionStatus,
      sourceComplete,
      complete:
        sourceComplete &&
        actionStatus === ReactOptimisticActionStatus.Action &&
        (descriptor.updaterStatus === ReactHookStateUpdaterStatus.DirectValue ||
          descriptor.updaterStatus === ReactHookStateUpdaterStatus.Pure),
    };
  });
  return { states, updates, callbacks, reachableFunctions, functionCalls };
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

const getImperativeHandleRefKind = (
  refKind: ImperativeHandleRefKind | null,
): ReactImperativeHandleRefKind | null => {
  if (refKind === ImperativeHandleRefKind.ForwardedRef) {
    return ReactImperativeHandleRefKind.ForwardedRef;
  }
  if (refKind === ImperativeHandleRefKind.RefProp) {
    return ReactImperativeHandleRefKind.RefProp;
  }
  return null;
};

const getLocalRefDeclarations = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyMap<ts.Symbol, ts.VariableDeclaration> => {
  const declarations = new Map<ts.Symbol, ts.VariableDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      getCanonicalReactApiName(node.initializer.expression, typeChecker) === "useRef"
    ) {
      const symbol = typeChecker.getSymbolAtLocation(node.name);
      if (symbol) declarations.set(symbol, node);
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return declarations;
};

const getJsxRefExpression = (attribute: ts.JsxAttribute): ts.Expression | null =>
  attribute.initializer &&
  ts.isJsxExpression(attribute.initializer) &&
  attribute.initializer.expression
    ? unwrapTypescriptExpression(attribute.initializer.expression)
    : null;

const getImperativeMethodCall = (
  currentAccess: ts.PropertyAccessExpression,
): {
  callExpression: ts.CallExpression;
  methodName: string;
} | null => {
  const methodAccess = currentAccess.parent;
  if (!ts.isPropertyAccessExpression(methodAccess) || methodAccess.expression !== currentAccess) {
    return null;
  }
  const callExpression = methodAccess.parent;
  return ts.isCallExpression(callExpression) && callExpression.expression === methodAccess
    ? { callExpression, methodName: methodAccess.name.text }
    : null;
};

const isConstVariableDeclaration = (declaration: ts.VariableDeclaration): boolean =>
  ts.isVariableDeclarationList(declaration.parent) &&
  (declaration.parent.flags & ts.NodeFlags.Const) !== 0;

const isHandleTargetReference = (
  node: ts.Node,
  descriptor: ImperativeHandleDescriptor,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => {
  const refExpression = descriptor.refExpression;
  if (!refExpression) return false;
  if (descriptor.refKind === ImperativeHandleRefKind.RefProp) {
    if (ts.isIdentifier(refExpression)) {
      return (
        ts.isIdentifier(node) &&
        isIdentifierReference(node) &&
        typeChecker.getSymbolAtLocation(node) === typeChecker.getSymbolAtLocation(refExpression)
      );
    }
    return (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      getComponentPropName(node, functionNode, typeChecker) === "ref"
    );
  }
  return (
    ts.isIdentifier(refExpression) &&
    ts.isIdentifier(node) &&
    isIdentifierReference(node) &&
    typeChecker.getSymbolAtLocation(node) === typeChecker.getSymbolAtLocation(refExpression)
  );
};

const isHandleTargetExclusive = (
  handleIdentity: ImperativeHandleIdentity,
  siblingHandles: ReadonlyArray<ImperativeHandleIdentity>,
  typeChecker: ts.TypeChecker,
): boolean => {
  const functionNode = handleIdentity.identity.descriptor.functionNode;
  if (!functionNode || !handleIdentity.descriptor.refExpression) return false;
  const allowedCalls = new Set<ts.CallExpression>();
  for (const candidate of siblingHandles) {
    if (
      candidate.descriptor.refName === handleIdentity.descriptor.refName &&
      candidate.descriptor.refKind === handleIdentity.descriptor.refKind
    ) {
      allowedCalls.add(candidate.descriptor.callExpression);
    }
  }
  let isExclusive = allowedCalls.size === 1;
  const visit = (node: ts.Node): void => {
    if (!isExclusive) return;
    if (isHandleTargetReference(node, handleIdentity.descriptor, functionNode, typeChecker)) {
      let currentNode: ts.Node = node;
      while (
        currentNode.parent &&
        (ts.isPropertyAccessExpression(currentNode.parent) ||
          ts.isElementAccessExpression(currentNode.parent) ||
          ts.isParenthesizedExpression(currentNode.parent) ||
          ts.isAsExpression(currentNode.parent) ||
          ts.isSatisfiesExpression(currentNode.parent) ||
          ts.isNonNullExpression(currentNode.parent))
      ) {
        currentNode = currentNode.parent;
      }
      const callExpression = ts.isCallExpression(currentNode.parent) ? currentNode.parent : null;
      if (
        !callExpression ||
        callExpression.arguments[0] !== currentNode ||
        !allowedCalls.has(callExpression)
      ) {
        isExclusive = false;
        return;
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return isExclusive;
};

const collectImperativeHandleGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  identitiesByFunction: ReadonlyMap<ts.FunctionLikeDeclaration, UnitGraphIdentity>,
  unitFunctionsBySymbol: ReadonlyMap<ts.Symbol, ts.FunctionLikeDeclaration>,
  renders: ReadonlyArray<ReactSemanticRender>,
  existingCallbacks: ReadonlyArray<ReactSemanticCallback>,
  existingReachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>,
  context: ReactAnalysisContext,
): ImperativeHandleGraphFacts => {
  const handleIdentities: ImperativeHandleIdentity[] = identities.flatMap((identity) => {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode || identity.descriptor.kind !== ReactUnitKind.Component) return [];
    return collectImperativeHandles(functionNode, context.typeChecker).map((descriptor) => {
      const handleId = createSemanticId(
        "imperative-handle",
        descriptor.refName ?? "unknown",
        descriptor.callExpression,
        context,
      );
      const methods = descriptor.methods.map((method) => ({
        descriptor: method,
        methodId: createSemanticId(
          `imperative-handle-method:${handleId}`,
          method.name,
          method.functionNode,
          context,
        ),
      }));
      return {
        descriptor,
        handleId,
        identity,
        methods,
        methodsByName: new Map(methods.map((method) => [method.descriptor.name, method])),
      };
    });
  });
  const existingCallbacksById = new Map(
    existingCallbacks.map((callback) => [callback.id, callback]),
  );
  const handlesByFunction = new Map<
    ts.FunctionLikeDeclaration,
    ReadonlyArray<ImperativeHandleIdentity>
  >();
  for (const handleIdentity of handleIdentities) {
    const functionNode = handleIdentity.identity.descriptor.functionNode;
    if (!functionNode) continue;
    handlesByFunction.set(functionNode, [
      ...(handlesByFunction.get(functionNode) ?? []),
      handleIdentity,
    ]);
  }
  const bindings: ImperativeHandleBindingDescriptor[] = [];
  const unsupportedHandleIds = new Set<string>();
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const localRefDeclarations = getLocalRefDeclarations(functionNode, context.typeChecker);
    const visit = (node: ts.Node): void => {
      if (node !== functionNode && isFunctionBoundary(node)) return;
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
        node.forEachChild(visit);
        return;
      }
      const targetFunction = getJsxComponentTargetFunction(
        node,
        unitFunctionsBySymbol,
        context.typeChecker,
      );
      const targetHandles = targetFunction ? (handlesByFunction.get(targetFunction) ?? []) : [];
      const refAttributes = node.attributes.properties.filter(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText() === "ref",
      );
      if (targetHandles.length === 0) {
        node.forEachChild(visit);
        return;
      }
      if (refAttributes.length !== 1) {
        if (node.attributes.properties.some(ts.isJsxSpreadAttribute)) {
          for (const targetHandle of targetHandles) unsupportedHandleIds.add(targetHandle.handleId);
        }
        node.forEachChild(visit);
        return;
      }
      const refAttribute = refAttributes[0];
      const refExpression = getJsxRefExpression(refAttribute);
      const refSymbol =
        refExpression && ts.isIdentifier(refExpression)
          ? context.typeChecker.getSymbolAtLocation(refExpression)
          : null;
      const refDeclaration = refSymbol ? localRefDeclarations.get(refSymbol) : null;
      const targetIdentity = targetFunction ? identitiesByFunction.get(targetFunction) : null;
      const tagLocation = getNodeLocation(node.tagName, context.rootDirectory);
      const render =
        targetIdentity &&
        renders.find(
          (candidate) =>
            candidate.ownerId === identity.semanticUnit.id &&
            candidate.targetId === targetIdentity.semanticUnit.id &&
            areProofLocationsEqual(candidate.location, tagLocation),
        );
      if (
        !refExpression ||
        !ts.isIdentifier(refExpression) ||
        !refSymbol ||
        !refDeclaration ||
        !targetIdentity ||
        targetHandles.length !== 1
      ) {
        for (const targetHandle of targetHandles) unsupportedHandleIds.add(targetHandle.handleId);
        node.forEachChild(visit);
        return;
      }
      bindings.push({
        handleIdentity: targetHandles[0],
        identity,
        refAttribute,
        refDeclaration,
        refName: refExpression.text,
        refSymbol,
        render: render ?? null,
        sourceComplete: Boolean(
          render?.kind === ReactSemanticRenderKind.Direct &&
          isConstVariableDeclaration(refDeclaration),
        ),
      });
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }
  const bindingsByRefSymbol = new Map<ts.Symbol, ImperativeHandleBindingDescriptor[]>();
  for (const binding of bindings) {
    bindingsByRefSymbol.set(binding.refSymbol, [
      ...(bindingsByRefSymbol.get(binding.refSymbol) ?? []),
      binding,
    ]);
  }
  for (const refBindings of bindingsByRefSymbol.values()) {
    if (refBindings.length === 1) continue;
    for (const binding of refBindings) binding.sourceComplete = false;
  }
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isIdentifierReference(node)) {
        const refSymbol = context.typeChecker.getSymbolAtLocation(node);
        const refBindings = refSymbol ? (bindingsByRefSymbol.get(refSymbol) ?? []) : [];
        if (refBindings.length > 0) {
          const isBindingUse = refBindings.some(
            (binding) => getJsxRefExpression(binding.refAttribute) === node,
          );
          const currentAccess =
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node &&
            node.parent.name.text === "current"
              ? node.parent
              : null;
          if (!isBindingUse && (!currentAccess || !getImperativeMethodCall(currentAccess))) {
            for (const binding of refBindings) binding.sourceComplete = false;
          }
        }
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }
  const invocationDescriptors: ImperativeHandleInvocationDescriptor[] = [];
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "current" &&
        ts.isIdentifier(unwrapTypescriptExpression(node.expression))
      ) {
        const refIdentifier = unwrapTypescriptExpression(node.expression);
        if (!ts.isIdentifier(refIdentifier)) {
          node.forEachChild(visit);
          return;
        }
        const refSymbol = context.typeChecker.getSymbolAtLocation(refIdentifier);
        const refBindings = refSymbol ? (bindingsByRefSymbol.get(refSymbol) ?? []) : [];
        if (refBindings.length !== 1) {
          node.forEachChild(visit);
          return;
        }
        const binding = refBindings[0];
        const methodCall = getImperativeMethodCall(node);
        if (!methodCall) {
          binding.sourceComplete = false;
          node.forEachChild(visit);
          return;
        }
        const method = binding.handleIdentity.methodsByName.get(methodCall.methodName) ?? null;
        const callerCallbackIds = collectExecutionCallbackIds({
          callbacks: existingCallbacks,
          evidenceNode: methodCall.callExpression,
          ownerId: identity.semanticUnit.id,
          reachableFunctions: existingReachableFunctions,
          rootDirectory: context.rootDirectory,
        });
        const callerCallbacks = callerCallbackIds.flatMap((callbackId) => {
          const callback = existingCallbacksById.get(callbackId);
          return callback ? [callback] : [];
        });
        const sourceComplete = Boolean(
          method &&
          binding.sourceComplete &&
          callerCallbacks.length === callerCallbackIds.length &&
          callerCallbacks.length > 0 &&
          callerCallbacks.every((callback) => callback.phase !== ReactExecutionPhase.Render),
        );
        if (!sourceComplete) binding.sourceComplete = false;
        invocationDescriptors.push({
          binding,
          callExpression: methodCall.callExpression,
          method,
          callerCallbackIds,
          sourceComplete,
        });
      }
      node.forEachChild(visit);
    };
    functionNode.forEachChild(visit);
  }
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const methodCallbacksByIdentity = new Map<string, ReactSemanticCallback>();
  const getMethodCallbacks = (
    invocation: ImperativeHandleInvocationDescriptor,
  ): ReadonlyArray<ReactSemanticCallback> => {
    const method = invocation.method;
    if (!method) return [];
    const ownerFunction = invocation.binding.handleIdentity.identity.descriptor.functionNode;
    if (!ownerFunction) return [];
    const hookBindings = collectHookBindings(ownerFunction, context.typeChecker);
    const stableSymbols = new Set([...hookBindings.refs, ...hookBindings.stateSetters]);
    const phases = [
      ...new Set(
        invocation.callerCallbackIds.flatMap((callbackId) => {
          const callback = existingCallbacksById.get(callbackId);
          return callback ? [callback.phase] : [];
        }),
      ),
    ];
    return phases.map((phase) => {
      const callbackIdentity = `${method.methodId}:${phase}`;
      const existingCallback = methodCallbacksByIdentity.get(callbackIdentity);
      if (existingCallback) return existingCallback;
      const callback = createCallbackFact(
        invocation.binding.handleIdentity.identity,
        method.descriptor.functionNode,
        ownerFunction,
        stableSymbols,
        ReactSemanticCallbackKind.ImperativeHandleMethod,
        phase,
        `${method.descriptor.name}@${phase}`,
        context,
      );
      methodCallbacksByIdentity.set(callbackIdentity, callback);
      callbacks.push(callback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        invocation.binding.handleIdentity.identity,
        method.descriptor.functionNode,
        callback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
      return callback;
    });
  };
  const semanticInvocations: ReactSemanticImperativeHandleInvocation[] =
    invocationDescriptors.flatMap((invocation) => {
      if (!invocation.method) return [];
      const bindingId = createSemanticId(
        `imperative-handle-binding:${invocation.binding.handleIdentity.handleId}`,
        invocation.binding.refName,
        invocation.binding.refAttribute,
        context,
      );
      const methodCallbacks = invocation.sourceComplete ? getMethodCallbacks(invocation) : [];
      return [
        {
          id: createSemanticId(
            `imperative-handle-invocation:${bindingId}`,
            invocation.method.descriptor.name,
            invocation.callExpression,
            context,
          ),
          ownerId: invocation.binding.identity.semanticUnit.id,
          handleId: invocation.binding.handleIdentity.handleId,
          methodId: invocation.method.methodId,
          bindingId,
          location: getNodeLocation(invocation.callExpression, context.rootDirectory),
          callerCallbackIds: invocation.callerCallbackIds,
          methodCallbackIds: methodCallbacks.map((callback) => callback.id),
          sourceComplete: invocation.sourceComplete,
          complete:
            invocation.sourceComplete &&
            methodCallbacks.length > 0 &&
            methodCallbacks.length ===
              new Set(methodCallbacks.map((callback) => callback.phase)).size,
        },
      ];
    });
  const semanticBindings: ReactSemanticImperativeHandleBinding[] = bindings.map((binding) => {
    const bindingId = createSemanticId(
      `imperative-handle-binding:${binding.handleIdentity.handleId}`,
      binding.refName,
      binding.refAttribute,
      context,
    );
    const bindingInvocations = semanticInvocations.filter(
      (invocation) => invocation.bindingId === bindingId,
    );
    return {
      id: bindingId,
      ownerId: binding.identity.semanticUnit.id,
      handleId: binding.handleIdentity.handleId,
      renderId: binding.render?.id ?? "unknown",
      refName: binding.refName,
      refLocation: getNodeLocation(binding.refDeclaration, context.rootDirectory),
      location: getNodeLocation(binding.refAttribute, context.rootDirectory),
      invocationIds: bindingInvocations.map((invocation) => invocation.id),
      referenceComplete: binding.sourceComplete,
      sourceComplete:
        binding.sourceComplete &&
        Boolean(binding.render) &&
        bindingInvocations.every((invocation) => invocation.sourceComplete),
      complete:
        binding.sourceComplete &&
        Boolean(binding.render) &&
        bindingInvocations.every((invocation) => invocation.complete),
    };
  });
  const semanticMethods: ReactSemanticImperativeHandleMethod[] = handleIdentities.flatMap(
    (handleIdentity) =>
      handleIdentity.methods.map((method) => ({
        id: method.methodId,
        ownerId: handleIdentity.identity.semanticUnit.id,
        handleId: handleIdentity.handleId,
        name: method.descriptor.name,
        location: getNodeLocation(method.descriptor.functionNode, context.rootDirectory),
      })),
  );
  const factoryCallbacks: ReactSemanticCallback[] = [];
  const handles: ReactSemanticImperativeHandle[] = handleIdentities.map((handleIdentity) => {
    const functionNode = handleIdentity.identity.descriptor.functionNode;
    const descriptor = handleIdentity.descriptor;
    const factoryFunction = descriptor.factoryFunction;
    const hookBindings = functionNode
      ? collectHookBindings(functionNode, context.typeChecker)
      : null;
    const stableSymbols = new Set([
      ...(hookBindings?.refs ?? []),
      ...(hookBindings?.stateSetters ?? []),
    ]);
    const factoryCallback =
      factoryFunction && functionNode
        ? createCallbackFact(
            handleIdentity.identity,
            factoryFunction,
            functionNode,
            stableSymbols,
            ReactSemanticCallbackKind.ImperativeHandleFactory,
            ReactExecutionPhase.ImperativeHandle,
            "createHandle",
            context,
          )
        : null;
    if (factoryCallback && factoryFunction) {
      factoryCallbacks.push(factoryCallback);
      const reachabilityFacts = collectReachabilityGraphFacts(
        handleIdentity.identity,
        factoryFunction,
        factoryCallback,
        context,
      );
      reachableFunctions.push(...reachabilityFacts.reachableFunctions);
      functionCalls.push(...reachabilityFacts.functionCalls);
    }
    const dependencyFacts = getHookDependencyFacts(descriptor.callExpression, 2);
    const captures = factoryCallback?.captures ?? [];
    const missingDependencies =
      dependencyFacts.mode === ReactEffectDependencyMode.Inline
        ? captures.filter(
            (capture) => !isReactiveCaptureDeclared(capture, dependencyFacts.dependencies),
          )
        : [];
    const factoryPurity = factoryFunction
      ? analyzeRenderPurity(factoryFunction, context).status
      : ReactObligationStatus.Unknown;
    const handleBindings = semanticBindings.filter(
      (binding) => binding.handleId === handleIdentity.handleId,
    );
    const targetExclusive = isHandleTargetExclusive(
      handleIdentity,
      functionNode ? (handlesByFunction.get(functionNode) ?? []) : [],
      context.typeChecker,
    );
    let status = ReactImperativeHandleStatus.Resolved;
    if (factoryPurity === ReactObligationStatus.Violated) {
      status = ReactImperativeHandleStatus.ImpureFactory;
    } else if (missingDependencies.length > 0) {
      status = ReactImperativeHandleStatus.MissingDependency;
    } else if (
      factoryPurity === ReactObligationStatus.Unknown ||
      dependencyFacts.mode === ReactEffectDependencyMode.Opaque ||
      !descriptor.shapeComplete ||
      !descriptor.targetComplete ||
      !targetExclusive ||
      unsupportedHandleIds.has(handleIdentity.handleId)
    ) {
      status = ReactImperativeHandleStatus.Opaque;
    }
    const sourceComplete =
      Boolean(factoryCallback) &&
      descriptor.shapeComplete &&
      descriptor.targetComplete &&
      targetExclusive &&
      handleBindings.length > 0 &&
      handleBindings.every((binding) => binding.sourceComplete) &&
      !unsupportedHandleIds.has(handleIdentity.handleId) &&
      !handleIdentity.identity.semanticUnit.canBeRenderRoot &&
      dependencyFacts.mode !== ReactEffectDependencyMode.Opaque &&
      factoryPurity !== ReactObligationStatus.Unknown;
    const bindingComplete =
      handleBindings.length > 0 &&
      handleBindings.every((binding) => binding.sourceComplete) &&
      !unsupportedHandleIds.has(handleIdentity.handleId);
    return {
      id: handleIdentity.handleId,
      ownerId: handleIdentity.identity.semanticUnit.id,
      refKind: getImperativeHandleRefKind(descriptor.refKind),
      refName: descriptor.refName,
      location: getNodeLocation(descriptor.callExpression, context.rootDirectory),
      factoryCallbackId: factoryCallback?.id ?? null,
      dependencyMode: dependencyFacts.mode,
      dependencies: dependencyFacts.dependencies,
      captures,
      factoryPurity,
      methodIds: handleIdentity.methods.map((method) => method.methodId),
      bindingIds: handleBindings.map((binding) => binding.id),
      factoryComplete:
        Boolean(factoryCallback) &&
        dependencyFacts.mode !== ReactEffectDependencyMode.Opaque &&
        factoryPurity !== ReactObligationStatus.Unknown,
      shapeComplete: descriptor.shapeComplete,
      targetComplete: descriptor.targetComplete && targetExclusive,
      bindingComplete,
      status,
      sourceComplete,
      complete: sourceComplete && status === ReactImperativeHandleStatus.Resolved,
    };
  });
  callbacks.unshift(...factoryCallbacks);
  return {
    handles,
    methods: semanticMethods,
    bindings: semanticBindings,
    invocations: semanticInvocations,
    callbacks,
    reachableFunctions,
    functionCalls,
  };
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
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  contexts: ReadonlyArray<ReactSemanticContext>,
  providers: ReadonlyArray<ReactSemanticContextProvider>,
  consumers: ReadonlyArray<ReactSemanticContextConsumer>,
): ReadonlyArray<ReactSemanticContextConsumer> => {
  const localUnitIds = new Set(units.map((unit) => unit.id));
  const customHookEdges = edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && localUnitIds.has(edge.targetId),
  );
  const rootUnitIds = units.flatMap((unit) => (unit.canBeRenderRoot ? [unit.id] : []));
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const rendersById = new Map(renders.map((render) => [render.id, render]));
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
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
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
    for (const slotFlow of slotFlows) {
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
        (sourceId) =>
          sourceId !== REACT_CONTEXT_DEFAULT_SOURCE_ID &&
          sourceId !== REACT_CONTEXT_UNKNOWN_SOURCE_ID,
      ),
      usesDefaultValue: sourceIds.includes(REACT_CONTEXT_DEFAULT_SOURCE_ID),
      topologyComplete:
        sourceIds.length > 0 && !sourceIds.includes(REACT_CONTEXT_UNKNOWN_SOURCE_ID),
    };
  });
};

const addFormSource = (
  sourcesByUnit: Map<string, Set<string>>,
  unitId: string,
  sourceId: string,
): boolean => {
  let sources = sourcesByUnit.get(unitId);
  if (!sources) {
    sources = new Set();
    sourcesByUnit.set(unitId, sources);
  }
  const previousSize = sources.size;
  sources.add(sourceId);
  return sources.size !== previousSize;
};

const resolveFormStatuses = (
  units: ReadonlyArray<ReactSemanticUnit>,
  edges: ReadonlyArray<ReactSemanticEdge>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  formStatuses: ReadonlyArray<ReactSemanticFormStatus>,
): ReadonlyArray<ReactSemanticFormStatus> => {
  const localUnitIds = new Set(units.map((unit) => unit.id));
  const customHookEdges = edges.filter(
    (edge) => edge.kind === ReactSemanticEdgeKind.CallsHook && localUnitIds.has(edge.targetId),
  );
  const rootUnitIds = units.flatMap((unit) => (unit.canBeRenderRoot ? [unit.id] : []));
  const rendersById = new Map(renders.map((render) => [render.id, render]));
  const sourcesByUnit = new Map<string, Set<string>>();
  for (const rootUnitId of rootUnitIds) {
    addFormSource(sourcesByUnit, rootUnitId, REACT_FORM_OUTSIDE_SOURCE_ID);
  }

  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of renders) {
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
      const nearestFormId = render.activeFormIds.at(-1);
      if (nearestFormId) {
        didSourcesChange =
          addFormSource(sourcesByUnit, render.targetId, nearestFormId) || didSourcesChange;
      } else {
        const ownerSources = sourcesByUnit.get(render.ownerId) ?? [];
        for (const sourceId of ownerSources) {
          if (!render.formTopologyComplete && sourceId === REACT_FORM_OUTSIDE_SOURCE_ID) {
            continue;
          }
          didSourcesChange =
            addFormSource(sourcesByUnit, render.targetId, sourceId) || didSourcesChange;
        }
      }
      if (!render.formTopologyComplete) {
        didSourcesChange =
          addFormSource(sourcesByUnit, render.targetId, REACT_FORM_UNKNOWN_SOURCE_ID) ||
          didSourcesChange;
      }
    }
    for (const slotFlow of slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (!sourceRender) continue;
      didSourcesChange =
        addFormSource(sourcesByUnit, sourceRender.targetId, REACT_FORM_UNKNOWN_SOURCE_ID) ||
        didSourcesChange;
    }
    for (const hookEdge of customHookEdges) {
      const ownerSources = sourcesByUnit.get(hookEdge.sourceId) ?? [];
      for (const sourceId of ownerSources) {
        didSourcesChange =
          addFormSource(sourcesByUnit, hookEdge.targetId, sourceId) || didSourcesChange;
      }
    }
  }

  return formStatuses.map((formStatus) => {
    const sources = [...(sourcesByUnit.get(formStatus.ownerId) ?? [])];
    const sourceFormIds = sources.filter(
      (sourceId) =>
        sourceId !== REACT_FORM_OUTSIDE_SOURCE_ID && sourceId !== REACT_FORM_UNKNOWN_SOURCE_ID,
    );
    const outsideForm = sources.includes(REACT_FORM_OUTSIDE_SOURCE_ID);
    const sourceComplete = sources.length > 0 && !sources.includes(REACT_FORM_UNKNOWN_SOURCE_ID);
    let status = ReactFormStatusTopologyStatus.Unknown;
    if (outsideForm) {
      status = ReactFormStatusTopologyStatus.OutsideForm;
    } else if (sourceComplete && sourceFormIds.length > 0) {
      status = ReactFormStatusTopologyStatus.Resolved;
    }
    return {
      ...formStatus,
      sourceFormIds,
      outsideForm,
      status,
      sourceComplete,
      complete: status === ReactFormStatusTopologyStatus.Resolved,
    };
  });
};

const isValidLazyLoaderReturn = (
  expression: ts.Expression,
  isAsyncLoader: boolean,
  typeChecker: ts.TypeChecker,
): boolean => {
  const returnType = typeChecker.getTypeAtLocation(expression);
  if (!isAsyncLoader && !returnType.getProperty("then")) return false;
  const resolvedType = typeChecker.getAwaitedType(returnType);
  if (!resolvedType) return false;
  const defaultSymbol = resolvedType.getProperty("default");
  if (!defaultSymbol) return false;
  const defaultType = typeChecker.getTypeOfSymbolAtLocation(defaultSymbol, expression);
  return (
    defaultType.getCallSignatures().length > 0 || defaultType.getConstructSignatures().length > 0
  );
};

const getLazyLoaderStatus = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): { sourceComplete: boolean; status: ReactLazyLoaderStatus } => {
  const loaderExpression = callExpression.arguments[0];
  if (!loaderExpression || !ts.isExpression(loaderExpression)) {
    return { sourceComplete: true, status: ReactLazyLoaderStatus.Invalid };
  }
  const loaderFunction = resolveFunction(loaderExpression, context.typeChecker);
  if (!loaderFunction) {
    return { sourceComplete: false, status: ReactLazyLoaderStatus.Opaque };
  }
  const returnSummary = summarizeFunctionReturns(loaderFunction, context.typeChecker);
  if (!returnSummary.isComplete) {
    return { sourceComplete: false, status: ReactLazyLoaderStatus.Opaque };
  }
  const isAsyncLoader = Boolean(
    ts.canHaveModifiers(loaderFunction) &&
    ts
      .getModifiers(loaderFunction)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  );
  const isValid =
    loaderFunction.parameters.every(
      (parameter) =>
        Boolean(parameter.dotDotDotToken || parameter.questionToken || parameter.initializer) ||
        (ts.isIdentifier(parameter.name) && parameter.name.text === "this"),
    ) &&
    !returnSummary.canFallThrough &&
    (!returnSummary.canThrow || isAsyncLoader) &&
    returnSummary.expressions.length > 0 &&
    returnSummary.expressions.every((descriptor) =>
      isValidLazyLoaderReturn(descriptor.expression, isAsyncLoader, context.typeChecker),
    );
  return {
    sourceComplete: true,
    status: isValid ? ReactLazyLoaderStatus.Valid : ReactLazyLoaderStatus.Invalid,
  };
};

const collectLazyComponentIdentities = (
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  identitiesByFunction: ReadonlyMap<ts.FunctionLikeDeclaration, UnitGraphIdentity>,
  context: ReactAnalysisContext,
): ReadonlyArray<LazyComponentIdentity> => {
  const lazyComponents: LazyComponentIdentity[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      getCanonicalReactApiName(node.expression, context.typeChecker) === "lazy"
    ) {
      const declarationExpression =
        ts.isCallExpression(node.parent) &&
        node.parent.arguments[0] === node &&
        getCanonicalReactApiName(node.parent.expression, context.typeChecker) === "memo"
          ? node.parent
          : node;
      let declaration: ts.Node = node;
      let componentName = "anonymous lazy component";
      let componentSymbol: ts.Symbol | null = null;
      if (
        ts.isVariableDeclaration(declarationExpression.parent) &&
        declarationExpression.parent.initializer === declarationExpression &&
        ts.isIdentifier(declarationExpression.parent.name)
      ) {
        declaration = declarationExpression.parent;
        componentName = declarationExpression.parent.name.text;
        const declarationSymbol = context.typeChecker.getSymbolAtLocation(
          declarationExpression.parent.name,
        );
        componentSymbol = declarationSymbol
          ? resolveAliasedSymbol(declarationSymbol, context.typeChecker)
          : null;
      } else if (
        ts.isPropertyAssignment(declarationExpression.parent) &&
        declarationExpression.parent.initializer === declarationExpression
      ) {
        declaration = declarationExpression.parent;
        componentName = getStaticPropertyName(declarationExpression.parent.name) ?? componentName;
        const propertySymbol = context.typeChecker.getSymbolAtLocation(
          declarationExpression.parent.name,
        );
        componentSymbol = propertySymbol
          ? resolveAliasedSymbol(propertySymbol, context.typeChecker)
          : null;
      } else if (
        ts.isExportAssignment(declarationExpression.parent) &&
        declarationExpression.parent.expression === declarationExpression &&
        !declarationExpression.parent.isExportEquals
      ) {
        declaration = declarationExpression.parent;
        componentName = "default lazy component";
        const moduleSymbol = context.typeChecker.getSymbolAtLocation(node.getSourceFile());
        const defaultSymbol = moduleSymbol
          ? context.typeChecker
              .getExportsOfModule(moduleSymbol)
              .find((exportSymbol) => exportSymbol.name === "default")
          : null;
        componentSymbol = defaultSymbol
          ? resolveAliasedSymbol(defaultSymbol, context.typeChecker)
          : null;
      }
      const containingFunction = getContainingFunction(declaration);
      const ownerIdentity = containingFunction
        ? identitiesByFunction.get(containingFunction)
        : null;
      const loader = getLazyLoaderStatus(node, context);
      const identityResolved = Boolean(componentSymbol);
      const resolvedComponentSymbol = componentSymbol
        ? resolveAliasedSymbol(componentSymbol, context.typeChecker)
        : null;
      lazyComponents.push({
        declaration,
        symbol: resolvedComponentSymbol,
        component: {
          id: createSemanticId("lazy-component", componentName, declaration, context),
          name: componentName,
          location: getNodeLocation(declaration, context.rootDirectory),
          declarationOwnerId: ownerIdentity?.semanticUnit.id ?? null,
          canBeRenderRoot: isDeclarationExported(
            declaration,
            resolvedComponentSymbol,
            context.typeChecker,
          ),
          identityResolved,
          declarationStatus: containingFunction
            ? ReactLazyDeclarationStatus.RenderUnstable
            : ReactLazyDeclarationStatus.ModuleStable,
          loaderStatus: loader.status,
          renderIds: [],
          sourceComplete: identityResolved && loader.sourceComplete,
          complete: false,
        },
      });
    }
    node.forEachChild(visit);
  };
  for (const sourceFile of sourceFiles) sourceFile.forEachChild(visit);
  return lazyComponents;
};

const addSuspenseSource = (
  sourcesByUnit: Map<string, Set<string>>,
  unitId: string,
  sourceId: string,
): boolean => {
  let sources = sourcesByUnit.get(unitId);
  if (!sources) {
    sources = new Set();
    sourcesByUnit.set(unitId, sources);
  }
  const previousSize = sources.size;
  sources.add(sourceId);
  return sources.size !== previousSize;
};

const deriveSuspenseSourcesByUnit = (
  units: ReadonlyArray<ReactSemanticUnit>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  suspenseBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const sourcesByUnit = new Map<string, Set<string>>();
  const rendersById = new Map(renders.map((render) => [render.id, render]));
  for (const unit of units) {
    if (unit.canBeRenderRoot) {
      addSuspenseSource(sourcesByUnit, unit.id, REACT_SUSPENSE_OUTSIDE_SOURCE_ID);
    }
  }
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of renders) {
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
      const boundaryIds = suspenseBoundaryIdsByRenderId.get(render.id) ?? [];
      if (boundaryIds.length > 0) {
        for (const boundaryId of boundaryIds) {
          didSourcesChange =
            addSuspenseSource(sourcesByUnit, render.targetId, boundaryId) || didSourcesChange;
        }
      } else {
        for (const sourceId of sourcesByUnit.get(render.ownerId) ?? []) {
          didSourcesChange =
            addSuspenseSource(sourcesByUnit, render.targetId, sourceId) || didSourcesChange;
        }
      }
    }
    for (const slotFlow of slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (sourceRender) {
        didSourcesChange =
          addSuspenseSource(
            sourcesByUnit,
            sourceRender.targetId,
            REACT_SUSPENSE_UNKNOWN_SOURCE_ID,
          ) || didSourcesChange;
      }
    }
  }
  return sourcesByUnit;
};

const addErrorBoundarySource = (
  sourcesByUnit: Map<string, Set<string>>,
  unitId: string,
  sourceId: string,
): boolean => {
  const sources = sourcesByUnit.get(unitId) ?? new Set<string>();
  const previousSize = sources.size;
  sources.add(sourceId);
  sourcesByUnit.set(unitId, sources);
  return sources.size !== previousSize;
};

const deriveErrorBoundarySourcesByUnit = (
  units: ReadonlyArray<ReactSemanticUnit>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  errorBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const sourcesByUnit = new Map<string, Set<string>>();
  const rendersById = new Map(renders.map((render) => [render.id, render]));
  for (const unit of units) {
    if (unit.canBeRenderRoot) {
      addErrorBoundarySource(sourcesByUnit, unit.id, REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID);
    }
  }
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of renders) {
      const boundaryIds = errorBoundaryIdsByRenderId.get(render.id) ?? [];
      if (render.kind === ReactSemanticRenderKind.SlotInput && boundaryIds.length === 0) {
        continue;
      }
      if (boundaryIds.length > 0) {
        for (const boundaryId of boundaryIds) {
          didSourcesChange =
            addErrorBoundarySource(sourcesByUnit, render.targetId, boundaryId) || didSourcesChange;
        }
      } else {
        for (const sourceId of sourcesByUnit.get(render.ownerId) ?? []) {
          didSourcesChange =
            addErrorBoundarySource(sourcesByUnit, render.targetId, sourceId) || didSourcesChange;
        }
      }
    }
    for (const slotFlow of slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (sourceRender && (errorBoundaryIdsByRenderId.get(sourceRender.id)?.length ?? 0) === 0) {
        didSourcesChange =
          addErrorBoundarySource(
            sourcesByUnit,
            sourceRender.targetId,
            REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID,
          ) || didSourcesChange;
      }
    }
  }
  return sourcesByUnit;
};

const findFirstThrowStatement = (
  functionNode: ts.FunctionLikeDeclaration,
): ts.ThrowStatement | null => {
  let throwStatement: ts.ThrowStatement | null = null;
  const visit = (node: ts.Node): void => {
    if (throwStatement || (node !== functionNode && isFunctionBoundary(node))) return;
    if (ts.isThrowStatement(node)) {
      throwStatement = node;
      return;
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return throwStatement;
};

const collectRenderErrorGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  errorBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>,
  errorBoundaries: ReadonlyArray<ReactSemanticErrorBoundary>,
  errorBoundaryDefinitions: ReadonlyArray<ReactSemanticErrorBoundaryDefinition>,
  context: ReactAnalysisContext,
): RenderErrorGraphFacts => {
  const sourcesByUnit = deriveErrorBoundarySourcesByUnit(
    identities.map((identity) => identity.semanticUnit),
    renders,
    slotFlows,
    errorBoundaryIdsByRenderId,
  );
  const boundariesById = new Map(errorBoundaries.map((boundary) => [boundary.id, boundary]));
  const definitionsById = new Map(
    errorBoundaryDefinitions.map((definition) => [definition.id, definition]),
  );
  const failures: ReactSemanticRenderFailure[] = [];
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const unitId = identity.semanticUnit.id;
    const sources = sourcesByUnit.get(unitId) ?? new Set<string>();
    if (sources.size === 0) continue;
    const reachableFunctions = collectReachableFunctionGraph(
      functionNode,
      context.typeChecker,
    ).functions.map((descriptor) => descriptor.functionNode);
    for (const reachableFunction of new Set([functionNode, ...reachableFunctions])) {
      const returnSummary = summarizeFunctionReturns(reachableFunction, context.typeChecker);
      if (!returnSummary.canThrow) continue;
      const throwStatement = findFirstThrowStatement(reachableFunction);
      if (!throwStatement) continue;
      const sourceBoundaryIds = [...sources].filter(
        (sourceId) =>
          sourceId !== REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID &&
          sourceId !== REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID,
      );
      const outsideBoundary = sources.has(REACT_ERROR_BOUNDARY_OUTSIDE_SOURCE_ID);
      const hasUnknownSource = sources.has(REACT_ERROR_BOUNDARY_UNKNOWN_SOURCE_ID);
      const sourceDefinitions = sourceBoundaryIds.flatMap((boundaryId) => {
        const boundary = boundariesById.get(boundaryId);
        const definition = boundary ? definitionsById.get(boundary.definitionId) : null;
        return definition ? [definition] : [];
      });
      const topologyComplete =
        !hasUnknownSource &&
        sourceDefinitions.length === sourceBoundaryIds.length &&
        sourceDefinitions.every((definition) => definition.sourceComplete);
      const hasValidBoundary = sourceDefinitions.some((definition) => definition.complete);
      let coverageStatus = ReactErrorBoundaryCoverageStatus.Unknown;
      if (outsideBoundary || (topologyComplete && !hasValidBoundary)) {
        coverageStatus = ReactErrorBoundaryCoverageStatus.OutsideBoundary;
      } else if (topologyComplete && hasValidBoundary) {
        coverageStatus = ReactErrorBoundaryCoverageStatus.Covered;
      }
      failures.push({
        id: createSemanticId(
          "render-failure",
          `${unitId}:${ReactRenderFailureKind.ExplicitThrow}`,
          throwStatement,
          context,
        ),
        ownerId: unitId,
        location: getNodeLocation(throwStatement, context.rootDirectory),
        kind: ReactRenderFailureKind.ExplicitThrow,
        sourceBoundaryIds,
        outsideBoundary,
        topologyComplete,
        sourceComplete: topologyComplete,
        coverageStatus,
        complete: coverageStatus === ReactErrorBoundaryCoverageStatus.Covered,
      });
    }
  }
  return { failures };
};

const resolveLazyComponentIdentity = (
  expression: ts.Expression | ts.JsxTagNameExpression,
  componentsBySymbol: ReadonlyMap<ts.Symbol, LazyComponentIdentity>,
  typeChecker: ts.TypeChecker,
  visitedSymbols: Set<ts.Symbol> = new Set(),
): LazyComponentIdentity | null => {
  if (ts.isJsxNamespacedName(expression)) return null;
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    ts.isCallExpression(unwrappedExpression) &&
    getCanonicalReactApiName(unwrappedExpression.expression, typeChecker) === "memo"
  ) {
    const memoTarget = unwrappedExpression.arguments[0];
    if (memoTarget && ts.isExpression(memoTarget)) {
      return resolveLazyComponentIdentity(
        memoTarget,
        componentsBySymbol,
        typeChecker,
        visitedSymbols,
      );
    }
  }
  const expressionSymbol = getExpressionSymbol(unwrappedExpression, typeChecker);
  if (!expressionSymbol || visitedSymbols.has(expressionSymbol)) return null;
  const directComponent = componentsBySymbol.get(expressionSymbol);
  if (directComponent) return directComponent;
  visitedSymbols.add(expressionSymbol);
  for (const declaration of expressionSymbol.declarations ?? []) {
    const initializer =
      (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) &&
      declaration.initializer &&
      ts.isExpression(declaration.initializer)
        ? unwrapTypescriptExpression(declaration.initializer)
        : null;
    if (initializer) {
      if (
        ts.isCallExpression(initializer) &&
        getCanonicalReactApiName(initializer.expression, typeChecker) === "memo"
      ) {
        const memoTarget = initializer.arguments[0];
        if (memoTarget && ts.isExpression(memoTarget)) {
          const memoComponent = resolveLazyComponentIdentity(
            memoTarget,
            componentsBySymbol,
            typeChecker,
            visitedSymbols,
          );
          if (memoComponent) return memoComponent;
        }
      }
      const aliasedComponent = resolveLazyComponentIdentity(
        initializer,
        componentsBySymbol,
        typeChecker,
        visitedSymbols,
      );
      if (aliasedComponent) return aliasedComponent;
    }
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const shorthandSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
      if (!shorthandSymbol) continue;
      const resolvedShorthandSymbol = resolveAliasedSymbol(shorthandSymbol, typeChecker);
      const shorthandComponent = componentsBySymbol.get(resolvedShorthandSymbol);
      if (shorthandComponent) return shorthandComponent;
    }
  }
  return null;
};

const collectReferencedLazyComponents = (
  expression: ts.Expression | ts.JsxTagNameExpression,
  componentsBySymbol: ReadonlyMap<ts.Symbol, LazyComponentIdentity>,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<LazyComponentIdentity> => {
  const componentsById = new Map<string, LazyComponentIdentity>();
  const visitedSymbols = new Set<ts.Symbol>();
  const visitSymbol = (symbol: ts.Symbol): void => {
    const resolvedSymbol = resolveAliasedSymbol(symbol, typeChecker);
    const component = componentsBySymbol.get(resolvedSymbol);
    if (component) {
      componentsById.set(component.component.id, component);
      return;
    }
    if (visitedSymbols.has(resolvedSymbol)) return;
    visitedSymbols.add(resolvedSymbol);
    for (const declaration of resolvedSymbol.declarations ?? []) {
      if (
        (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) &&
        declaration.initializer
      ) {
        visitNode(declaration.initializer);
      } else if (ts.isShorthandPropertyAssignment(declaration)) {
        const shorthandSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
        if (shorthandSymbol) visitSymbol(shorthandSymbol);
      } else if (ts.isBindingElement(declaration)) {
        const variableDeclaration = declaration.parent.parent;
        if (ts.isVariableDeclaration(variableDeclaration) && variableDeclaration.initializer) {
          visitNode(variableDeclaration.initializer);
        }
      } else if (isFunctionBoundary(declaration) && declaration.body) {
        const visitReturn = (returnNode: ts.Node): void => {
          if (returnNode !== declaration && isFunctionBoundary(returnNode)) return;
          if (ts.isReturnStatement(returnNode) && returnNode.expression) {
            visitNode(returnNode.expression);
            return;
          }
          returnNode.forEachChild(visitReturn);
        };
        declaration.body.forEachChild(visitReturn);
      }
    }
    for (const sourceFile of new Set(
      (resolvedSymbol.declarations ?? []).map((declaration) => declaration.getSourceFile()),
    )) {
      const writes = [
        ...collectSymbolWrites(resolvedSymbol, sourceFile, typeChecker),
        ...collectPropertySymbolWrites(resolvedSymbol, sourceFile, typeChecker),
      ];
      for (const write of writes) {
        if (ts.isBinaryExpression(write)) visitNode(write.right);
      }
    }
  };
  const visitNode = (node: ts.Node): void => {
    if (
      isFunctionBoundary(node) ||
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      return;
    }
    if (
      (ts.isExpression(node) || ts.isJsxTagNameExpression(node)) &&
      !ts.isJsxNamespacedName(node)
    ) {
      const symbol = getExpressionSymbol(node, typeChecker);
      if (symbol) visitSymbol(symbol);
    }
    node.forEachChild(visitNode);
  };
  visitNode(expression);
  return [...componentsById.values()];
};

const collectExportedLazyComponentIds = (
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  componentsBySymbol: ReadonlyMap<ts.Symbol, LazyComponentIdentity>,
  typeChecker: ts.TypeChecker,
): ReadonlySet<string> => {
  const componentIds = new Set<string>();
  const collectExposedComponentIds = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      return;
    }
    if (isFunctionBoundary(node)) {
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        collectExposedComponentIds(node.body);
        return;
      }
      const visitReturn = (returnNode: ts.Node): void => {
        if (returnNode !== node && isFunctionBoundary(returnNode)) return;
        if (ts.isReturnStatement(returnNode) && returnNode.expression) {
          collectExposedComponentIds(returnNode.expression);
          return;
        }
        returnNode.forEachChild(visitReturn);
      };
      node.forEachChild(visitReturn);
      return;
    }
    if (ts.isExpression(node) && !ts.isJsxNamespacedName(node)) {
      const component = resolveLazyComponentIdentity(node, componentsBySymbol, typeChecker);
      if (component) componentIds.add(component.component.id);
    }
    node.forEachChild(collectExposedComponentIds);
  };
  for (const sourceFile of sourceFiles) {
    const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exportSymbol of typeChecker.getExportsOfModule(moduleSymbol)) {
      const resolvedExportSymbol = resolveAliasedSymbol(exportSymbol, typeChecker);
      const directComponent = componentsBySymbol.get(resolvedExportSymbol);
      if (directComponent) {
        componentIds.add(directComponent.component.id);
        continue;
      }
      for (const declaration of resolvedExportSymbol.declarations ?? []) {
        let exportExpression: ts.Expression | null = null;
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
          exportExpression = declaration.initializer;
        } else if (ts.isExportAssignment(declaration) && ts.isExpression(declaration.expression)) {
          exportExpression = declaration.expression;
        }
        if (!exportExpression) continue;
        collectExposedComponentIds(exportExpression);
        const component = resolveLazyComponentIdentity(
          exportExpression,
          componentsBySymbol,
          typeChecker,
        );
        if (component) componentIds.add(component.component.id);
      }
    }
  }
  return componentIds;
};

const deriveReachableFunctionSuspenseSources = (
  rootFunction: ts.FunctionLikeDeclaration,
  reachabilityGraph: ReachableFunctionGraphDescriptor,
  suspenseBoundariesByOpeningNode: ReadonlyMap<
    ts.JsxOpeningLikeElement,
    ReactSemanticSuspenseBoundary
  >,
  typeChecker: ts.TypeChecker,
): ReadonlyMap<ts.FunctionLikeDeclaration, ReadonlySet<string>> => {
  const sourcesByFunction = new Map<ts.FunctionLikeDeclaration, Set<string>>([
    [rootFunction, new Set([REACT_SUSPENSE_OWNER_SOURCE_ID])],
  ]);
  const addSource = (functionNode: ts.FunctionLikeDeclaration, sourceId: string): boolean => {
    const sources = sourcesByFunction.get(functionNode) ?? new Set<string>();
    const previousSize = sources.size;
    sources.add(sourceId);
    sourcesByFunction.set(functionNode, sources);
    return sources.size !== previousSize;
  };
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const call of reachabilityGraph.calls) {
      const directBoundaryIds = collectActiveSuspenseBoundaryIds(
        call.callExpression,
        suspenseBoundariesByOpeningNode,
      );
      const sourceIds =
        directBoundaryIds.length > 0
          ? directBoundaryIds
          : [...(sourcesByFunction.get(call.sourceFunctionNode) ?? [])];
      for (const sourceId of sourceIds) {
        didSourcesChange = addSource(call.targetFunctionNode, sourceId) || didSourcesChange;
      }
    }
  }
  for (const unmodeledUse of reachabilityGraph.unmodeledCallableUses) {
    if (!ts.isExpression(unmodeledUse.node)) continue;
    const targetFunction = resolveFunction(unmodeledUse.node, typeChecker);
    if (targetFunction && sourcesByFunction.has(targetFunction)) {
      addSource(targetFunction, REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    }
  }
  for (const descriptor of reachabilityGraph.functions) {
    if (!sourcesByFunction.has(descriptor.functionNode)) {
      addSource(descriptor.functionNode, REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    }
  }
  return sourcesByFunction;
};

const collectLazyGraph = (
  identities: ReadonlyArray<UnitGraphIdentity>,
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  identitiesByFunction: ReadonlyMap<ts.FunctionLikeDeclaration, UnitGraphIdentity>,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  slotFlow: ComponentSlotFlowDescriptor,
  providersByOpeningNode: ReadonlyMap<ts.JsxOpeningLikeElement, ReactSemanticContextProvider>,
  suspenseBoundariesByOpeningNode: ReadonlyMap<
    ts.JsxOpeningLikeElement,
    ReactSemanticSuspenseBoundary
  >,
  suspenseBoundaryIdsByRenderId: ReadonlyMap<string, ReadonlyArray<string>>,
  context: ReactAnalysisContext,
): LazyGraphFacts => {
  const componentIdentities = collectLazyComponentIdentities(
    sourceFiles,
    identitiesByFunction,
    context,
  );
  const componentsBySymbol = new Map(
    componentIdentities.flatMap(
      (identity): ReadonlyArray<[ts.Symbol, LazyComponentIdentity]> =>
        identity.symbol ? [[identity.symbol, identity]] : [],
    ),
  );
  const identitiesByUnitId = new Map(
    identities.map((identity) => [identity.semanticUnit.id, identity]),
  );
  const exportedLazyComponentIds = collectExportedLazyComponentIds(
    sourceFiles,
    componentsBySymbol,
    context.typeChecker,
  );
  const rendersById = new Map(renders.map((render) => [render.id, render]));
  const lazyRenders: ReactSemanticLazyRender[] = [];
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    if (!functionNode) continue;
    const reachabilityGraph = collectReachableFunctionGraph(functionNode, context.typeChecker);
    const reachableRenderFunctions = reachabilityGraph.functions.map(
      (descriptor) => descriptor.functionNode,
    );
    const suspenseSourcesByRenderFunction = deriveReachableFunctionSuspenseSources(
      functionNode,
      reachabilityGraph,
      suspenseBoundariesByOpeningNode,
      context.typeChecker,
    );
    const visit = (node: ts.Node, renderFunction: ts.FunctionLikeDeclaration): void => {
      if (node !== functionNode && isFunctionBoundary(node)) return;
      const isNestedRenderFunction = renderFunction !== functionNode;
      const openingElement =
        ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
      if (!openingElement || ts.isJsxNamespacedName(openingElement.tagName)) {
        node.forEachChild((childNode) => visit(childNode, renderFunction));
        return;
      }
      const resolvedLazyComponent = resolveLazyComponentIdentity(
        openingElement.tagName,
        componentsBySymbol,
        context.typeChecker,
      );
      const referencedLazyComponents = resolvedLazyComponent
        ? [resolvedLazyComponent]
        : collectReferencedLazyComponents(
            openingElement.tagName,
            componentsBySymbol,
            context.typeChecker,
          );
      if (referencedLazyComponents.length === 0) {
        node.forEachChild((childNode) => visit(childNode, renderFunction));
        return;
      }
      let slotBoundary = getContainingRenderSlotBoundary(
        openingElement.tagName,
        unitIdsBySymbol,
        providersByOpeningNode,
        context,
      );
      const suspenseFallbackElement = getContainingSuspenseFallbackElement(
        openingElement.tagName,
        suspenseBoundariesByOpeningNode,
      );
      if (
        slotBoundary &&
        suspenseFallbackElement &&
        isNodeWithin(suspenseFallbackElement, slotBoundary.node)
      ) {
        slotBoundary = null;
      }
      const topologyBoundaryIds = new Set(
        collectActiveSuspenseBoundaryIds(
          openingElement.tagName,
          suspenseBoundariesByOpeningNode,
          slotBoundary?.node ?? null,
        ),
      );
      let inheritsOwnerBoundary = topologyBoundaryIds.size === 0;
      let topologyComplete = Boolean(resolvedLazyComponent) && (slotBoundary?.complete ?? true);
      if (isNestedRenderFunction && topologyBoundaryIds.size === 0) {
        inheritsOwnerBoundary = false;
        const functionSources = suspenseSourcesByRenderFunction.get(renderFunction);
        for (const sourceId of functionSources ?? []) {
          if (sourceId === REACT_SUSPENSE_OWNER_SOURCE_ID) {
            inheritsOwnerBoundary = true;
          } else if (sourceId === REACT_SUSPENSE_UNKNOWN_SOURCE_ID) {
            topologyComplete = false;
          } else {
            topologyBoundaryIds.add(sourceId);
          }
        }
        if (!functionSources || functionSources.size === 0) topologyComplete = false;
      }
      if (slotBoundary) {
        inheritsOwnerBoundary = false;
        const containerRender = slotBoundary.containerRenderId
          ? rendersById.get(slotBoundary.containerRenderId)
          : null;
        const containerIdentity = containerRender
          ? identitiesByUnitId.get(containerRender.targetId)
          : null;
        const containerFunction = containerIdentity?.descriptor.functionNode ?? null;
        const resolution =
          containerFunction && slotBoundary.propName
            ? slotFlow.resolveSlot(containerFunction, slotBoundary.propName)
            : { complete: false, placements: [] };
        topologyComplete =
          topologyComplete && resolution.complete && resolution.placements.length > 0;
        for (const placement of resolution.placements) {
          const placementIdentities = placement.topologyFrames.map((topologyFrame) =>
            identitiesByFunction.get(topologyFrame.ownerFunction),
          );
          if (placementIdentities.some((placementIdentity) => !placementIdentity)) {
            topologyComplete = false;
            continue;
          }
          const placementBoundaryIds = new Set([
            ...topologyBoundaryIds,
            ...placement.topologyFrames.flatMap((topologyFrame) =>
              collectActiveSuspenseBoundaryIds(topologyFrame.node, suspenseBoundariesByOpeningNode),
            ),
          ]);
          if (placementBoundaryIds.size === 0) inheritsOwnerBoundary = true;
          for (const boundaryId of placementBoundaryIds) {
            topologyBoundaryIds.add(boundaryId);
          }
        }
      }
      for (const lazyComponent of referencedLazyComponents) {
        lazyRenders.push({
          id: createSemanticId(
            "lazy-render",
            `${identity.semanticUnit.id}:${lazyComponent.component.id}`,
            openingElement.tagName,
            context,
          ),
          ownerId: identity.semanticUnit.id,
          lazyComponentId: lazyComponent.component.id,
          location: getNodeLocation(openingElement.tagName, context.rootDirectory),
          topologyBoundaryIds: [...topologyBoundaryIds],
          sourceBoundaryIds: [],
          inheritsOwnerBoundary,
          outsideBoundary: false,
          topologyComplete,
          sourceComplete: false,
          coverageStatus: ReactSuspenseCoverageStatus.Unknown,
          complete: false,
        });
      }
      node.forEachChild((childNode) => visit(childNode, renderFunction));
    };
    functionNode.forEachChild((childNode) => visit(childNode, functionNode));
    for (const reachableRenderFunction of reachableRenderFunctions) {
      if (reachableRenderFunction === functionNode) continue;
      reachableRenderFunction.forEachChild((childNode) =>
        visit(childNode, reachableRenderFunction),
      );
    }
  }
  const suspenseSourcesByUnit = deriveSuspenseSourcesByUnit(
    identities.map((identity) => identity.semanticUnit),
    renders,
    slotFlows,
    suspenseBoundaryIdsByRenderId,
  );
  const resolvedRenders = lazyRenders.map((render): ReactSemanticLazyRender => {
    const sources = new Set(render.topologyBoundaryIds);
    if (render.inheritsOwnerBoundary) {
      for (const sourceId of suspenseSourcesByUnit.get(render.ownerId) ?? []) {
        sources.add(sourceId);
      }
    }
    if (!render.topologyComplete) sources.add(REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    const outsideBoundary = sources.has(REACT_SUSPENSE_OUTSIDE_SOURCE_ID);
    const sourceComplete = sources.size > 0 && !sources.has(REACT_SUSPENSE_UNKNOWN_SOURCE_ID);
    const sourceBoundaryIds = [...sources].filter(
      (sourceId) =>
        sourceId !== REACT_SUSPENSE_OUTSIDE_SOURCE_ID &&
        sourceId !== REACT_SUSPENSE_UNKNOWN_SOURCE_ID,
    );
    let coverageStatus = ReactSuspenseCoverageStatus.Unknown;
    if (outsideBoundary) {
      coverageStatus = ReactSuspenseCoverageStatus.OutsideBoundary;
    } else if (sourceComplete && sourceBoundaryIds.length > 0) {
      coverageStatus = ReactSuspenseCoverageStatus.Covered;
    }
    return {
      ...render,
      sourceBoundaryIds,
      outsideBoundary,
      sourceComplete,
      coverageStatus,
      complete: coverageStatus === ReactSuspenseCoverageStatus.Covered,
    };
  });
  const rendersByComponentId = new Map<string, ReactSemanticLazyRender[]>();
  for (const render of resolvedRenders) {
    const componentRenders = rendersByComponentId.get(render.lazyComponentId) ?? [];
    componentRenders.push(render);
    rendersByComponentId.set(render.lazyComponentId, componentRenders);
  }
  return {
    components: componentIdentities.map(({ component }) => {
      const componentRenders = rendersByComponentId.get(component.id) ?? [];
      const canBeRenderRoot =
        component.canBeRenderRoot || exportedLazyComponentIds.has(component.id);
      const complete =
        component.identityResolved &&
        !canBeRenderRoot &&
        component.declarationStatus === ReactLazyDeclarationStatus.ModuleStable &&
        component.loaderStatus === ReactLazyLoaderStatus.Valid &&
        componentRenders.every((render) => render.complete);
      return {
        ...component,
        canBeRenderRoot,
        renderIds: componentRenders.map((render) => render.id),
        complete,
      };
    }),
    renders: resolvedRenders,
  };
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
        canBeRenderRoot:
          (descriptor.kind === ReactUnitKind.Component ||
            descriptor.kind === ReactUnitKind.ClassComponent) &&
          isDescriptorExported(descriptor, context.typeChecker),
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
  const unitFunctionsBySymbol = new Map(
    [...unitIdentitiesBySymbol].flatMap(
      ([symbol, identity]): ReadonlyArray<[ts.Symbol, ts.FunctionLikeDeclaration]> =>
        identity.descriptor.functionNode ? [[symbol, identity.descriptor.functionNode]] : [],
    ),
  );
  const contextGraph = collectContextGraph(identities, sourceFiles, context);
  const formTopologyGraph = collectFormTopologyGraph(identities, context);
  const suspenseGraph = collectSuspenseGraph(identities, context);
  const errorBoundaryGraph = collectErrorBoundaryGraph(identities, unitIdsBySymbol, context);
  const edges: ReactSemanticEdge[] = [];
  const renders: ReactSemanticRender[] = [];
  const errorBoundaryIdsByRenderId = new Map<string, ReadonlyArray<string>>();
  const suspenseBoundaryIdsByRenderId = new Map<string, ReadonlyArray<string>>();
  const hookCalls: ReactSemanticHookCall[] = [];
  const effects: ReactSemanticEffect[] = [];
  const schedulers: ReactSemanticScheduler[] = [];
  const resources: ReactSemanticEffectResource[] = [];
  const classConstructions: ReactSemanticClassConstruction[] = [];
  const classLifecycles: ReactSemanticClassLifecycle[] = [];
  const classStateWrites: ReactSemanticClassStateWrite[] = [];
  const classStateTransitions: ReactSemanticClassStateTransition[] = [];
  const actionStates: ReactSemanticActionState[] = [];
  const actionStateDispatches: ReactSemanticActionStateDispatch[] = [];
  const formActions: ReactSemanticFormAction[] = [];
  const hookStateTransitions: ReactSemanticHookStateTransition[] = [];
  const reducers: ReactSemanticReducer[] = [];
  const reducerDispatches: ReactSemanticReducerDispatch[] = [];
  const optimisticStates: ReactSemanticOptimisticState[] = [];
  const optimisticUpdates: ReactSemanticOptimisticUpdate[] = [];
  const transitionActions: ReactSemanticTransitionAction[] = [];
  const effectEvents: ReactSemanticEffectEvent[] = [];
  const externalStores: ReactSemanticExternalStore[] = [];
  const asyncTasks: ReactSemanticAsyncTask[] = [];
  const callbacks: ReactSemanticCallback[] = [];
  const reachableFunctions: ReactSemanticReachableFunction[] = [];
  const functionCalls: ReactSemanticFunctionCall[] = [];
  const componentFlow = createComponentCallbackFlow(
    [...unitIdentitiesByFunction.keys()],
    unitFunctionsBySymbol,
    context.typeChecker,
  );
  const slotFlow = createComponentSlotFlow(
    [...unitIdentitiesByFunction.keys()],
    unitFunctionsBySymbol,
    new Set(contextGraph.providersByOpeningNode.keys()),
    context.typeChecker,
  );
  const eventGraph = collectEventGraph(identities, context, componentFlow);
  callbacks.push(...eventGraph.callbacks);
  reachableFunctions.push(...eventGraph.reachableFunctions);
  functionCalls.push(...eventGraph.functionCalls);
  const actionStateCallbacksByDispatcher = new Map<ts.Symbol, ReactSemanticCallback>();
  for (const identity of identities) {
    const actionStateDefinitionGraph = collectActionStateDefinitionGraph(identity, context);
    actionStates.push(...actionStateDefinitionGraph.states);
    callbacks.push(...actionStateDefinitionGraph.callbacks);
    reachableFunctions.push(...actionStateDefinitionGraph.reachableFunctions);
    functionCalls.push(...actionStateDefinitionGraph.functionCalls);
    for (const [dispatcherSymbol, callback] of actionStateDefinitionGraph.callbacksByDispatcher) {
      actionStateCallbacksByDispatcher.set(dispatcherSymbol, callback);
    }
  }
  const formActionGraph = collectFormActionGraph(
    identities,
    context,
    componentFlow,
    actionStateCallbacksByDispatcher,
  );
  formActions.push(...formActionGraph.actions);
  callbacks.push(...formActionGraph.callbacks);
  reachableFunctions.push(...formActionGraph.reachableFunctions);
  functionCalls.push(...formActionGraph.functionCalls);
  for (const identity of identities) {
    const functionNode = identity.descriptor.functionNode;
    const unitKind = identity.descriptor.kind;
    if (
      functionNode &&
      (unitKind === ReactUnitKind.Component ||
        unitKind === ReactUnitKind.ClassComponent ||
        unitKind === ReactUnitKind.Hook)
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
      formTopologyGraph.formsByOpeningNode,
      errorBoundaryGraph.boundariesByOpeningNode,
      suspenseGraph.boundariesByOpeningNode,
      context,
    );
    edges.push(...renderGraph.edges);
    renders.push(...renderGraph.renders);
    for (const [renderId, boundaryIds] of renderGraph.errorBoundaryIdsByRenderId) {
      errorBoundaryIdsByRenderId.set(renderId, boundaryIds);
    }
    for (const [renderId, boundaryIds] of renderGraph.suspenseBoundaryIdsByRenderId) {
      suspenseBoundaryIdsByRenderId.set(renderId, boundaryIds);
    }
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
    const reducerGraph = collectReducerDefinitionGraph(identity, context);
    reducers.push(...reducerGraph.reducers);
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
  const imperativeHandleGraph = collectImperativeHandleGraph(
    identities,
    unitIdentitiesByFunction,
    unitFunctionsBySymbol,
    renders,
    callbacks,
    reachableFunctions,
    context,
  );
  callbacks.push(...imperativeHandleGraph.callbacks);
  reachableFunctions.push(...imperativeHandleGraph.reachableFunctions);
  functionCalls.push(...imperativeHandleGraph.functionCalls);
  for (const identity of identities) {
    const transitionActionGraph = collectTransitionActionGraph(
      identity,
      callbacks,
      reachableFunctions,
      context,
    );
    transitionActions.push(...transitionActionGraph.actions);
    callbacks.push(...transitionActionGraph.callbacks);
    reachableFunctions.push(...transitionActionGraph.reachableFunctions);
    functionCalls.push(...transitionActionGraph.functionCalls);
  }
  const callbackPropGraph = collectCallbackPropGraph(identities, context, componentFlow, callbacks);
  callbacks.push(...callbackPropGraph.callbacks);
  reachableFunctions.push(...callbackPropGraph.reachableFunctions);
  functionCalls.push(...callbackPropGraph.functionCalls);
  for (const identity of identities) {
    const actionStateDispatchGraph = collectActionStateDispatchGraph(
      identity,
      actionStates,
      formActions,
      transitionActions,
      callbacks,
      reachableFunctions,
      context,
    );
    actionStateDispatches.push(...actionStateDispatchGraph.dispatches);
  }
  for (const identity of identities) {
    const reducerDispatchGraph = collectReducerDispatchGraph(
      identity,
      reducers,
      callbacks,
      reachableFunctions,
      context,
    );
    reducerDispatches.push(...reducerDispatchGraph.dispatches);
  }
  for (const identity of identities) {
    const hookStateTransitionGraph = collectHookStateTransitionGraph(
      identity,
      callbacks,
      reachableFunctions,
      context,
    );
    hookStateTransitions.push(...hookStateTransitionGraph.transitions);
    callbacks.push(...hookStateTransitionGraph.callbacks);
    reachableFunctions.push(...hookStateTransitionGraph.reachableFunctions);
    functionCalls.push(...hookStateTransitionGraph.functionCalls);
  }
  for (const identity of identities) {
    const optimisticStateGraph = collectOptimisticStateGraph(
      identity,
      callbacks,
      reachableFunctions,
      transitionActions,
      context,
    );
    optimisticStates.push(...optimisticStateGraph.states);
    optimisticUpdates.push(...optimisticStateGraph.updates);
    callbacks.push(...optimisticStateGraph.callbacks);
    reachableFunctions.push(...optimisticStateGraph.reachableFunctions);
    functionCalls.push(...optimisticStateGraph.functionCalls);
  }
  const slotGraph = collectSlotGraph(
    renders,
    errorBoundaryIdsByRenderId,
    suspenseBoundaryIdsByRenderId,
    unitIdentitiesByFunction,
    slotFlow,
    contextGraph.providersByOpeningNode,
    formTopologyGraph.formsByOpeningNode,
    errorBoundaryGraph.boundariesByOpeningNode,
    suspenseGraph.boundariesByOpeningNode,
    context,
  );
  const contextConsumers = resolveContextConsumers(
    identities.map((identity) => identity.semanticUnit),
    edges,
    slotGraph.renders,
    slotGraph.slotFlows,
    contextGraph.contexts,
    contextGraph.contextProviders,
    contextGraph.contextConsumers,
  );
  const formStatuses = resolveFormStatuses(
    identities.map((identity) => identity.semanticUnit),
    edges,
    slotGraph.renders,
    slotGraph.slotFlows,
    formTopologyGraph.formStatuses,
  );
  const lazyGraph = collectLazyGraph(
    identities,
    sourceFiles,
    unitIdentitiesByFunction,
    unitIdsBySymbol,
    slotGraph.renders,
    slotGraph.slotFlows,
    slotFlow,
    contextGraph.providersByOpeningNode,
    suspenseGraph.boundariesByOpeningNode,
    slotGraph.suspenseBoundaryIdsByRenderId,
    context,
  );
  const renderIdsByErrorBoundaryId = new Map<string, string[]>();
  for (const render of slotGraph.renders) {
    for (const boundaryId of slotGraph.errorBoundaryIdsByRenderId.get(render.id) ?? []) {
      const renderIds = renderIdsByErrorBoundaryId.get(boundaryId) ?? [];
      renderIds.push(render.id);
      renderIdsByErrorBoundaryId.set(boundaryId, renderIds);
    }
  }
  const errorBoundaries = errorBoundaryGraph.boundaries.map((boundary) => ({
    ...boundary,
    renderIds: renderIdsByErrorBoundaryId.get(boundary.id) ?? [],
  }));
  const renderErrorGraph = collectRenderErrorGraph(
    identities,
    slotGraph.renders,
    slotGraph.slotFlows,
    slotGraph.errorBoundaryIdsByRenderId,
    errorBoundaries,
    errorBoundaryGraph.definitions,
    context,
  );
  const renderIdsBySuspenseBoundaryId = new Map<string, string[]>();
  for (const render of slotGraph.renders) {
    for (const boundaryId of slotGraph.suspenseBoundaryIdsByRenderId.get(render.id) ?? []) {
      const renderIds = renderIdsBySuspenseBoundaryId.get(boundaryId) ?? [];
      renderIds.push(render.id);
      renderIdsBySuspenseBoundaryId.set(boundaryId, renderIds);
    }
  }
  const suspenseBoundaries = suspenseGraph.boundaries.map((boundary) => ({
    ...boundary,
    renderIds: renderIdsBySuspenseBoundaryId.get(boundary.id) ?? [],
  }));
  const callableRefs = collectCallableRefGraph(identities, callbacks, functionCalls, context);
  return {
    schemaVersion: REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
    actionStates,
    actionStateDispatches,
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
    errorBoundaryDefinitions: errorBoundaryGraph.definitions,
    errorBoundaries,
    renderFailures: renderErrorGraph.failures,
    suspenseBoundaries,
    lazyComponents: lazyGraph.components,
    lazyRenders: lazyGraph.renders,
    renders: slotGraph.renders,
    slotFlows: slotGraph.slotFlows,
    callbacks,
    reachableFunctions,
    functionCalls,
    eventBindings: eventGraph.eventBindings,
    callbackPropFlows: callbackPropGraph.callbackPropFlows,
    callableRefs,
    imperativeHandles: imperativeHandleGraph.handles,
    imperativeHandleMethods: imperativeHandleGraph.methods,
    imperativeHandleBindings: imperativeHandleGraph.bindings,
    imperativeHandleInvocations: imperativeHandleGraph.invocations,
    schedulers,
    resources,
    classConstructions,
    classLifecycles,
    classStateWrites,
    classStateTransitions,
    formActions,
    forms: formTopologyGraph.forms,
    formStatuses,
    hookStateTransitions,
    reducers,
    reducerDispatches,
    optimisticStates,
    optimisticUpdates,
    transitionActions,
    compiler: extractReactCompilerGraph(sourceFiles, context.rootDirectory),
  };
};
