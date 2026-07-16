import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { executesDuringRender } from "../../../utils/executes-during-render.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../../utils/do-nodes-cover-every-path-from-function-entry.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getRangeStart } from "../../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { resolveEventListenerCapture } from "./resolve-event-listener-capture.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";

interface ExternalLocationInvalidationCheckerOptions {
  componentBody: EsTreeNodeOfType<"BlockStatement">;
  componentFunction: EsTreeNode;
  context: RuleContext;
  renderReachableExpressions: EsTreeNode[];
  renderReachableNames: ReadonlySet<string>;
}

interface ExternalLocationInvalidationChecker {
  (setterBindingIdentifier: EsTreeNode): boolean;
}

interface LocationListenerRegistration {
  capture: boolean | null;
  callExpression: EsTreeNode;
  eventName: string;
  listenerFunction: EsTreeNode;
}

interface LocationListenerOperation {
  operation: "add" | "remove";
  registration: LocationListenerRegistration;
}

interface LocationInvalidationIndex {
  componentFunction: EsTreeNode;
  context: RuleContext;
  effectCallbacks: Set<EsTreeNode>;
  expressionsByOwner: Map<EsTreeNode, Set<EsTreeNode>>;
  historyMutationsByOwner: Map<EsTreeNode, Set<EsTreeNode>>;
  awaitExpressionsByOwner: Map<EsTreeNode, Set<EsTreeNode>>;
  callSitesByFunction: Map<EsTreeNode, Set<EsTreeNode>>;
  calledFunctionByExpression: Map<EsTreeNode, EsTreeNode>;
  synchronousInvocationsByFunction: Map<EsTreeNode, Set<EsTreeNode>>;
  synchronousCallbacksByExpression: Map<EsTreeNode, Set<EsTreeNode>>;
  callsByCalleeSymbolId: Map<number, Set<EsTreeNode>>;
  listenerRegistrations: LocationListenerRegistration[];
  listenerRemovals: LocationListenerRegistration[];
  mountedListenerFunctions: Set<EsTreeNode>;
  mutationExecutionsByOwner: Map<EsTreeNode, Set<EsTreeNode>>;
  synchronousMutationResultByFunction: Map<EsTreeNode, boolean>;
}

const HISTORY_LOCATION_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "pushState",
  "replaceState",
]);
const LOCATION_CHANGE_EVENT_NAMES: ReadonlySet<string> = new Set(["hashchange", "popstate"]);

const containsGlobalLocationSnapshotRead = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didFindLocationSnapshotRead = false;
  walkAst(node, (child: EsTreeNode): boolean | void => {
    if (didFindLocationSnapshotRead) return false;
    if (child !== node && isFunctionLike(child) && !executesDuringRender(child, scopes)) {
      return false;
    }
    if (!isProvenGlobalNamespaceReference(child, "location", scopes)) return;
    didFindLocationSnapshotRead = true;
    return false;
  });
  return didFindLocationSnapshotRead;
};

const hasRenderReachableLocationSnapshotRead = (
  componentBody: EsTreeNodeOfType<"BlockStatement">,
  renderReachableExpressions: EsTreeNode[],
  renderReachableNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    renderReachableExpressions.some((expression) =>
      containsGlobalLocationSnapshotRead(expression, scopes),
    )
  ) {
    return true;
  }

  for (const statement of componentBody.body ?? []) {
    if (isNodeOfType(statement, "FunctionDeclaration") && statement.id) {
      if (
        renderReachableNames.has(statement.id.name) &&
        containsGlobalLocationSnapshotRead(statement.body, scopes)
      ) {
        return true;
      }
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      if (!renderReachableNames.has(declarator.id.name)) continue;
      let renderReachableValue = isFunctionLike(declarator.init)
        ? declarator.init.body
        : declarator.init;
      if (
        isNodeOfType(declarator.init, "CallExpression") &&
        isReactApiCall(declarator.init, "useCallback", scopes)
      ) {
        const callback = declarator.init.arguments?.[0];
        if (callback && !isNodeOfType(callback, "SpreadElement") && isFunctionLike(callback)) {
          renderReachableValue = callback.body;
        }
      }
      if (containsGlobalLocationSnapshotRead(renderReachableValue, scopes)) return true;
    }
  }
  return false;
};

const isGlobalHistoryLocationMutation = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    methodName &&
    HISTORY_LOCATION_MUTATION_METHOD_NAMES.has(methodName) &&
    isProvenGlobalNamespaceReference(callee.object, "history", scopes),
  );
};

const getStaticLocationChangeEvent = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const eventNameNode = stripParenExpression(node);
  if (!isNodeOfType(eventNameNode, "Literal") || typeof eventNameNode.value !== "string") {
    return null;
  }
  return LOCATION_CHANGE_EVENT_NAMES.has(eventNameNode.value) ? eventNameNode.value : null;
};

const addToSetIndex = <Key, Value>(index: Map<Key, Set<Value>>, key: Key, value: Value): void => {
  const indexedValues = index.get(key) ?? new Set<Value>();
  indexedValues.add(value);
  index.set(key, indexedValues);
};

const getSynchronousInvocationExpression = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!executesDuringRender(functionNode, scopes)) return null;
  const parent = functionNode.parent;
  return isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")
    ? parent
    : null;
};

const getLocationListenerOperation = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): LocationListenerOperation | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  const methodName = isNodeOfType(callee, "MemberExpression")
    ? getStaticPropertyName(callee)
    : isNodeOfType(callee, "Identifier")
      ? callee.name
      : null;
  if (methodName !== "addEventListener" && methodName !== "removeEventListener") return null;
  const isGlobalListenerOperation = isNodeOfType(callee, "MemberExpression")
    ? isProvenGlobalObjectReference(callee.object, scopes)
    : isNodeOfType(callee, "Identifier") && scopes.isGlobalReference(callee);
  if (!isGlobalListenerOperation) return null;
  const eventName = getStaticLocationChangeEvent(callExpression.arguments?.[0]);
  if (!eventName) return null;
  const listenerExpression = callExpression.arguments?.[1];
  if (!listenerExpression || isNodeOfType(listenerExpression, "SpreadElement")) return null;
  const listenerFunction = resolveExactLocalFunction(listenerExpression, scopes);
  if (!isFunctionLike(listenerFunction)) return null;
  const captureArgument = callExpression.arguments?.[2];
  const capture = isNodeOfType(captureArgument, "SpreadElement")
    ? null
    : resolveEventListenerCapture(captureArgument, {
        allowComputedString: true,
        allowIndeterminateEntries: true,
      });
  return {
    operation: methodName === "addEventListener" ? "add" : "remove",
    registration: { callExpression, listenerFunction, capture, eventName },
  };
};

const buildLocationInvalidationIndex = (
  componentBody: EsTreeNode,
  componentFunction: EsTreeNode,
  context: RuleContext,
): LocationInvalidationIndex => {
  const index: LocationInvalidationIndex = {
    componentFunction,
    context,
    effectCallbacks: new Set(),
    expressionsByOwner: new Map(),
    historyMutationsByOwner: new Map(),
    awaitExpressionsByOwner: new Map(),
    callSitesByFunction: new Map(),
    calledFunctionByExpression: new Map(),
    synchronousInvocationsByFunction: new Map(),
    synchronousCallbacksByExpression: new Map(),
    callsByCalleeSymbolId: new Map(),
    listenerRegistrations: [],
    listenerRemovals: [],
    mountedListenerFunctions: new Set(),
    mutationExecutionsByOwner: new Map(),
    synchronousMutationResultByFunction: new Map(),
  };

  walkAst(componentBody, (child: EsTreeNode): void => {
    if (isFunctionLike(child)) {
      const invocationExpression = getSynchronousInvocationExpression(child, context.scopes);
      if (invocationExpression) {
        addToSetIndex(index.synchronousInvocationsByFunction, child, invocationExpression);
        addToSetIndex(index.synchronousCallbacksByExpression, invocationExpression, child);
      }
      return;
    }

    const owner = context.cfg.enclosingFunction(child);
    if (!owner) return;
    if (isNodeOfType(child, "AwaitExpression")) {
      addToSetIndex(index.awaitExpressionsByOwner, owner, child);
      return;
    }
    if (!isNodeOfType(child, "CallExpression") && !isNodeOfType(child, "NewExpression")) {
      return;
    }
    addToSetIndex(index.expressionsByOwner, owner, child);

    if (isNodeOfType(child, "CallExpression")) {
      if (isGlobalHistoryLocationMutation(child, context.scopes)) {
        addToSetIndex(index.historyMutationsByOwner, owner, child);
      }
      const callee = stripParenExpression(child.callee);
      if (isNodeOfType(callee, "Identifier")) {
        const calleeSymbol = context.scopes.symbolFor(callee);
        if (calleeSymbol) addToSetIndex(index.callsByCalleeSymbolId, calleeSymbol.id, child);
      }
      const calledFunction = resolveExactLocalFunction(child.callee, context.scopes);
      if (isFunctionLike(calledFunction)) {
        addToSetIndex(index.callSitesByFunction, calledFunction, child);
        index.calledFunctionByExpression.set(child, calledFunction);
      }
      if (
        context.cfg.enclosingFunction(child) === componentFunction &&
        isReactApiCall(child, EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveNamedAliases: true,
        })
      ) {
        const effectCallback = getEffectCallback(child, context.scopes);
        if (isFunctionLike(effectCallback)) index.effectCallbacks.add(effectCallback);
      }
      const listenerOperation = getLocationListenerOperation(child, context.scopes);
      if (listenerOperation?.operation === "add") {
        index.listenerRegistrations.push(listenerOperation.registration);
      } else if (listenerOperation) {
        index.listenerRemovals.push(listenerOperation.registration);
      }
    }
  });
  return index;
};

const isDescendantWithoutFunctionBoundary = (
  descendant: EsTreeNode,
  ancestor: EsTreeNode,
): boolean => {
  let current: EsTreeNode | null | undefined = descendant;
  while (current && current !== ancestor) {
    if (current !== descendant && isFunctionLike(current)) return false;
    current = current.parent;
  }
  return current === ancestor;
};

const areInMutuallyExclusiveConditionalBranches = (
  firstNode: EsTreeNode,
  secondNode: EsTreeNode,
): boolean => {
  const firstBranches = new Map<EsTreeNode, EsTreeNode>();
  let current: EsTreeNode | null | undefined = firstNode;
  while (current?.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      firstBranches.set(parent, current);
    }
    if (current !== firstNode && isFunctionLike(current)) break;
    current = parent;
  }
  current = secondNode;
  while (current?.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      const firstBranch = firstBranches.get(parent);
      if (firstBranch && firstBranch !== current) return true;
    }
    if (current !== secondNode && isFunctionLike(current)) break;
    current = parent;
  }
  return false;
};

const isInsideIntrinsicReactEventHandlerAttribute = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode | null,
): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== functionBoundary) {
    if (isEventHandlerAttribute(current) && isJsxAttributeOnIntrinsicHtmlElement(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const isExclusiveIntrinsicReactEventHandler = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) {
    return isInsideIntrinsicReactEventHandlerAttribute(functionNode, index.componentFunction);
  }
  const bindingSymbol = index.context.scopes.symbolFor(bindingIdentifier);
  return Boolean(
    bindingSymbol &&
    bindingSymbol.references.length > 0 &&
    bindingSymbol.references.every((reference) =>
      isInsideIntrinsicReactEventHandlerAttribute(reference.identifier, index.componentFunction),
    ),
  );
};

const canNodeReachNode = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  const { context } = index;
  if (!isNodeReachableWithinFunction(sourceNode, context)) return false;
  if (!isNodeReachableWithinFunction(targetNode, context)) return false;
  const sourceOwner = context.cfg.enclosingFunction(sourceNode);
  const targetOwner = context.cfg.enclosingFunction(targetNode);
  if (!sourceOwner || sourceOwner !== targetOwner) return false;
  if (areInMutuallyExclusiveConditionalBranches(sourceNode, targetNode)) return false;
  if (isDescendantWithoutFunctionBoundary(sourceNode, targetNode)) return true;
  const functionCfg = context.cfg.cfgFor(sourceOwner);
  const sourceBlock = functionCfg?.blockOf(sourceNode);
  const targetBlock = functionCfg?.blockOf(targetNode);
  if (!functionCfg || !sourceBlock || !targetBlock) return false;
  if (sourceBlock === targetBlock) {
    const sourceStart = getRangeStart(sourceNode);
    const targetStart = getRangeStart(targetNode);
    return sourceStart !== null && targetStart !== null && sourceStart < targetStart;
  }
  const visitedBlocks = new Set([sourceBlock]);
  const pendingBlocks = sourceBlock.successors
    .filter((edge) => edge.kind !== "throw")
    .map((edge) => edge.to);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block || visitedBlocks.has(block)) continue;
    if (block === targetBlock) return true;
    visitedBlocks.add(block);
    for (const edge of block.successors) {
      if (edge.kind !== "throw") pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const canNodeReachNormalFunctionExit = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  const functionCfg = index.context.cfg.cfgFor(functionNode);
  const sourceBlock = functionCfg?.blockOf(node);
  if (!functionCfg || !sourceBlock) return false;
  const visitedBlocks = new Set<typeof sourceBlock>();
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block || visitedBlocks.has(block)) continue;
    visitedBlocks.add(block);
    for (const edge of block.successors) {
      if (edge.kind === "throw") continue;
      if (edge.to === functionCfg.exit) return true;
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const canExecuteBeforeAsyncSuspension = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  if (!isFunctionLike(functionNode) || !functionNode.async) {
    return isNodeReachableWithinFunction(node, index.context);
  }
  const functionCfg = index.context.cfg.cfgFor(functionNode);
  const targetBlock = functionCfg?.blockOf(node);
  if (!functionCfg || !targetBlock) return false;
  const awaitsByBlock = new Map<typeof targetBlock, EsTreeNode[]>();
  for (const awaitExpression of index.awaitExpressionsByOwner.get(functionNode) ?? []) {
    const awaitBlock = functionCfg.blockOf(awaitExpression);
    if (!awaitBlock) continue;
    const blockAwaits = awaitsByBlock.get(awaitBlock) ?? [];
    blockAwaits.push(awaitExpression);
    awaitsByBlock.set(awaitBlock, blockAwaits);
  }
  const visitedBlocks = new Set<typeof targetBlock>();
  const pendingBlocks = [functionCfg.entry];
  const targetStart = getRangeStart(node);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block || visitedBlocks.has(block)) continue;
    visitedBlocks.add(block);
    const blockAwaits = awaitsByBlock.get(block) ?? [];
    if (block === targetBlock) {
      return !blockAwaits.some((awaitExpression) => {
        if (
          isNodeOfType(awaitExpression, "AwaitExpression") &&
          isDescendantWithoutFunctionBoundary(node, awaitExpression.argument)
        ) {
          return false;
        }
        const awaitStart = getRangeStart(awaitExpression);
        return awaitStart !== null && targetStart !== null && awaitStart < targetStart;
      });
    }
    if (blockAwaits.length > 0) continue;
    for (const edge of block.successors) {
      if (edge.kind !== "throw") pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const canReactEventBatchMutationAfterExecution = (
  executionNode: EsTreeNode,
  mutationNode: EsTreeNode,
  owner: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean =>
  isExclusiveIntrinsicReactEventHandler(owner, index) &&
  (index.awaitExpressionsByOwner.get(owner)?.size ?? 0) === 0 &&
  canNodeReachNode(executionNode, mutationNode, index) &&
  canNodeReachNormalFunctionExit(mutationNode, owner, index);

const functionMaySynchronouslyMutateLocation = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
  visitingFunctions: Set<EsTreeNode>,
  cycleAffectedFunctions: Set<EsTreeNode>,
): boolean => {
  const cachedResult = index.synchronousMutationResultByFunction.get(functionNode);
  if (cachedResult !== undefined) return cachedResult;
  if (!isFunctionLike(functionNode) || functionNode.generator) return false;
  if (visitingFunctions.has(functionNode)) {
    let didReachCycleEntry = false;
    for (const visitingFunction of visitingFunctions) {
      if (visitingFunction === functionNode) didReachCycleEntry = true;
      if (didReachCycleEntry) cycleAffectedFunctions.add(visitingFunction);
    }
    return false;
  }
  visitingFunctions.add(functionNode);
  const mutationExecutions = collectLocationMutationExecutions(
    functionNode,
    index,
    visitingFunctions,
    cycleAffectedFunctions,
  );
  const doesMutateSynchronously = [...mutationExecutions].some(
    (mutationExecution) =>
      canExecuteBeforeAsyncSuspension(mutationExecution, functionNode, index) &&
      canNodeReachNormalFunctionExit(mutationExecution, functionNode, index),
  );
  visitingFunctions.delete(functionNode);
  if (doesMutateSynchronously || !cycleAffectedFunctions.has(functionNode)) {
    index.synchronousMutationResultByFunction.set(functionNode, doesMutateSynchronously);
  }
  return doesMutateSynchronously;
};

const collectLocationMutationExecutions = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
  visitingFunctions = new Set<EsTreeNode>(),
  cycleAffectedFunctions = new Set<EsTreeNode>(),
): Set<EsTreeNode> => {
  const cachedExecutions = index.mutationExecutionsByOwner.get(functionNode);
  if (cachedExecutions) return cachedExecutions;
  const mutationExecutions = new Set(index.historyMutationsByOwner.get(functionNode) ?? []);
  for (const expression of index.expressionsByOwner.get(functionNode) ?? []) {
    const calledFunction = index.calledFunctionByExpression.get(expression);
    if (
      calledFunction &&
      functionMaySynchronouslyMutateLocation(
        calledFunction,
        index,
        visitingFunctions,
        cycleAffectedFunctions,
      )
    ) {
      mutationExecutions.add(expression);
    }
    for (const callbackFunction of index.synchronousCallbacksByExpression.get(expression) ?? []) {
      if (
        functionMaySynchronouslyMutateLocation(
          callbackFunction,
          index,
          visitingFunctions,
          cycleAffectedFunctions,
        )
      ) {
        mutationExecutions.add(expression);
      }
    }
  }
  if (!cycleAffectedFunctions.has(functionNode)) {
    index.mutationExecutionsByOwner.set(functionNode, mutationExecutions);
  }
  return mutationExecutions;
};

const isDefinitelyMatchingLocationListenerRemoval = (
  registration: LocationListenerRegistration,
  removal: LocationListenerRegistration,
): boolean =>
  registration.eventName === removal.eventName &&
  registration.listenerFunction === removal.listenerFunction &&
  registration.capture !== null &&
  removal.capture !== null &&
  registration.capture === removal.capture;

const functionMustSynchronouslyRemoveLocationListener = (
  functionNode: EsTreeNode,
  registration: LocationListenerRegistration,
  index: LocationInvalidationIndex,
  visitingFunctions: Set<EsTreeNode>,
): boolean => {
  if (!isFunctionLike(functionNode) || functionNode.generator) return false;
  if (visitingFunctions.has(functionNode)) return false;
  const nextVisitingFunctions = new Set(visitingFunctions);
  nextVisitingFunctions.add(functionNode);
  const removalExecutions: EsTreeNode[] = [];
  for (const removal of index.listenerRemovals) {
    if (!isDefinitelyMatchingLocationListenerRemoval(registration, removal)) continue;
    if (index.context.cfg.enclosingFunction(removal.callExpression) !== functionNode) continue;
    if (canExecuteBeforeAsyncSuspension(removal.callExpression, functionNode, index)) {
      removalExecutions.push(removal.callExpression);
    }
  }
  for (const expression of index.expressionsByOwner.get(functionNode) ?? []) {
    const calledFunction = index.calledFunctionByExpression.get(expression);
    if (
      calledFunction &&
      canExecuteBeforeAsyncSuspension(expression, functionNode, index) &&
      functionMustSynchronouslyRemoveLocationListener(
        calledFunction,
        registration,
        index,
        nextVisitingFunctions,
      )
    ) {
      removalExecutions.push(expression);
    }
  }
  return doNodesCoverEveryPathFromFunctionEntry(functionNode, removalExecutions, index.context);
};

const collectSynchronousLocationListenerRemovalExecutions = (
  functionNode: EsTreeNode,
  registration: LocationListenerRegistration,
  index: LocationInvalidationIndex,
): Set<EsTreeNode> => {
  const removalExecutions = new Set<EsTreeNode>();
  for (const removal of index.listenerRemovals) {
    if (
      isDefinitelyMatchingLocationListenerRemoval(registration, removal) &&
      index.context.cfg.enclosingFunction(removal.callExpression) === functionNode &&
      canExecuteBeforeAsyncSuspension(removal.callExpression, functionNode, index)
    ) {
      removalExecutions.add(removal.callExpression);
    }
  }
  for (const expression of index.expressionsByOwner.get(functionNode) ?? []) {
    const calledFunction = index.calledFunctionByExpression.get(expression);
    if (
      calledFunction &&
      canExecuteBeforeAsyncSuspension(expression, functionNode, index) &&
      functionMustSynchronouslyRemoveLocationListener(
        calledFunction,
        registration,
        index,
        new Set(),
      )
    ) {
      removalExecutions.add(expression);
    }
  }
  return removalExecutions;
};

const canExecutionReachFunctionExitWithoutListenerRemoval = (
  executionNode: EsTreeNode,
  registration: LocationListenerRegistration,
  index: LocationInvalidationIndex,
): boolean => {
  if (!isNodeReachableWithinFunction(executionNode, index.context)) return false;
  const owner = index.context.cfg.enclosingFunction(executionNode);
  if (!owner) return false;
  const functionCfg = index.context.cfg.cfgFor(owner);
  const sourceBlock = functionCfg?.blockOf(executionNode);
  if (!functionCfg || !sourceBlock) return false;
  const matchingRemovalsByBlock = new Map<typeof sourceBlock, EsTreeNode[]>();
  for (const removalExecution of collectSynchronousLocationListenerRemovalExecutions(
    owner,
    registration,
    index,
  )) {
    const removalBlock = functionCfg.blockOf(removalExecution);
    if (!removalBlock) continue;
    const blockRemovals = matchingRemovalsByBlock.get(removalBlock) ?? [];
    blockRemovals.push(removalExecution);
    matchingRemovalsByBlock.set(removalBlock, blockRemovals);
  }
  const sourceStart = getRangeStart(executionNode);
  const hasRemovalAfterExecution = (block: typeof sourceBlock): boolean => {
    const removals = matchingRemovalsByBlock.get(block) ?? [];
    if (block !== sourceBlock) return removals.length > 0;
    return removals.some((removal) => {
      const removalStart = getRangeStart(removal);
      return sourceStart !== null && removalStart !== null && sourceStart < removalStart;
    });
  };
  const visitedBlocks = new Set<typeof sourceBlock>();
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block || visitedBlocks.has(block)) continue;
    visitedBlocks.add(block);
    if (hasRemovalAfterExecution(block)) continue;
    for (const edge of block.successors) {
      if (edge.kind === "throw") continue;
      if (edge.to === functionCfg.exit) return true;
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const isListenerActiveAtMountedExit = (
  executionNode: EsTreeNode,
  registration: LocationListenerRegistration,
  index: LocationInvalidationIndex,
  visitedExecutions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedExecutions.has(executionNode)) return false;
  if (!canExecutionReachFunctionExitWithoutListenerRemoval(executionNode, registration, index)) {
    return false;
  }
  const owner = index.context.cfg.enclosingFunction(executionNode);
  if (!owner) return false;
  if (owner === index.componentFunction || index.effectCallbacks.has(owner)) return true;
  const nextVisitedExecutions = new Set(visitedExecutions);
  nextVisitedExecutions.add(executionNode);
  for (const callSite of index.callSitesByFunction.get(owner) ?? []) {
    if (isListenerActiveAtMountedExit(callSite, registration, index, nextVisitedExecutions)) {
      return true;
    }
  }
  for (const invocation of index.synchronousInvocationsByFunction.get(owner) ?? []) {
    if (isListenerActiveAtMountedExit(invocation, registration, index, nextVisitedExecutions)) {
      return true;
    }
  }
  return false;
};

const collectMountedListenerFunctions = (index: LocationInvalidationIndex): void => {
  for (const registration of index.listenerRegistrations) {
    if (isListenerActiveAtMountedExit(registration.callExpression, registration, index)) {
      index.mountedListenerFunctions.add(registration.listenerFunction);
    }
  }
};

const setterArgumentMutatesLocation = (
  setterCall: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  if (!isNodeOfType(setterCall, "CallExpression")) return false;
  return (setterCall.arguments ?? []).some((argument) => {
    if (isNodeOfType(argument, "SpreadElement")) return false;
    const updaterFunction = resolveExactLocalFunction(argument, index.context.scopes);
    return Boolean(
      isFunctionLike(updaterFunction) &&
      functionMaySynchronouslyMutateLocation(updaterFunction, index, new Set(), new Set()),
    );
  });
};

const executionAnchorInvalidatesLocationSnapshot = (
  executionAnchor: EsTreeNode,
  index: LocationInvalidationIndex,
  visitedExecutions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedExecutions.has(executionAnchor)) return false;
  if (!isNodeReachableWithinFunction(executionAnchor, index.context)) return false;
  const owner = index.context.cfg.enclosingFunction(executionAnchor);
  if (!owner) return false;
  if (index.mountedListenerFunctions.has(owner)) return true;
  if (
    setterArgumentMutatesLocation(executionAnchor, index) ||
    [...collectLocationMutationExecutions(owner, index)].some(
      (mutationExecution) =>
        canNodeReachNode(mutationExecution, executionAnchor, index) ||
        canReactEventBatchMutationAfterExecution(executionAnchor, mutationExecution, owner, index),
    )
  ) {
    return true;
  }
  const nextVisitedExecutions = new Set(visitedExecutions);
  nextVisitedExecutions.add(executionAnchor);
  for (const callSite of index.callSitesByFunction.get(owner) ?? []) {
    if (executionAnchorInvalidatesLocationSnapshot(callSite, index, nextVisitedExecutions)) {
      return true;
    }
  }
  for (const invocation of index.synchronousInvocationsByFunction.get(owner) ?? []) {
    if (executionAnchorInvalidatesLocationSnapshot(invocation, index, nextVisitedExecutions)) {
      return true;
    }
  }
  return false;
};

const setterInvalidatesGlobalLocationSnapshot = (
  setterBindingIdentifier: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  const setterSymbol = index.context.scopes.symbolFor(setterBindingIdentifier);
  if (!setterSymbol) return false;
  const setterCalls = index.callsByCalleeSymbolId.get(setterSymbol.id) ?? [];
  return [...setterCalls].some((setterCall) =>
    executionAnchorInvalidatesLocationSnapshot(setterCall, index),
  );
};

export const createExternalLocationInvalidationChecker = ({
  componentBody,
  componentFunction,
  context,
  renderReachableExpressions,
  renderReachableNames,
}: ExternalLocationInvalidationCheckerOptions): ExternalLocationInvalidationChecker => {
  if (
    !hasRenderReachableLocationSnapshotRead(
      componentBody,
      renderReachableExpressions,
      renderReachableNames,
      context.scopes,
    )
  ) {
    return () => false;
  }
  const locationInvalidationIndex = buildLocationInvalidationIndex(
    componentBody,
    componentFunction,
    context,
  );
  collectMountedListenerFunctions(locationInvalidationIndex);
  return (setterBindingIdentifier) =>
    setterInvalidatesGlobalLocationSnapshot(setterBindingIdentifier, locationInvalidationIndex);
};
