import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../../../constants/js.js";
import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { collectExpressionPathCoverageNodes } from "../../../utils/collect-expression-path-coverage-nodes.js";
import { canExecuteBeforeAsyncSuspension } from "../../../utils/can-execute-before-async-suspension.js";
import { executesDuringRender } from "../../../utils/executes-during-render.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../../utils/do-nodes-cover-every-path-from-function-entry.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { getFinalSequenceExpressionValue } from "../../../utils/get-final-sequence-expression-value.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getRangeStart } from "../../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isDescendantWithoutFunctionBoundary } from "../../../utils/is-descendant-without-function-boundary.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
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
  directRenderNames: ReadonlySet<string>;
  renderReachableExpressions: EsTreeNode[];
}

interface ExternalLocationInvalidationChecker {
  (setterBindingIdentifier: EsTreeNode): boolean;
}

interface ReadonlyValueEscapeOptions {
  rejectKnownMutations?: boolean;
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
  identifierCalls: Set<EsTreeNode>;
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

const AGGREGATE_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  ...MUTATING_ARRAY_METHODS,
  ...MUTATING_COLLECTION_METHODS,
]);

const OBJECT_AGGREGATE_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "setPrototypeOf",
]);

const REFLECT_AGGREGATE_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "defineProperty",
  "deleteProperty",
  "set",
  "setPrototypeOf",
]);
const LOCATION_CHANGE_EVENT_NAMES: ReadonlySet<string> = new Set(["hashchange", "popstate"]);

const containsGlobalLocationSnapshotRead = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didFindLocationSnapshotRead = false;
  walkAst(node, (child: EsTreeNode): boolean | void => {
    if (didFindLocationSnapshotRead) return false;
    if (
      child !== node &&
      isFunctionLike(child) &&
      !executesDuringRender(findTransparentExpressionRoot(child), scopes)
    ) {
      return false;
    }
    if (!isProvenGlobalNamespaceReference(child, "location", scopes)) return;
    didFindLocationSnapshotRead = true;
    return false;
  });
  return didFindLocationSnapshotRead;
};

const resolveExactLocalOrReactCallbackFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const localFunction = resolveExactLocalFunction(expression, scopes);
  if (isFunctionLike(localFunction)) return localFunction;

  const unwrappedExpression = stripParenExpression(expression);
  let callbackSource = unwrappedExpression;
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const callbackSymbol = resolveConstIdentifierAlias(unwrappedExpression, scopes);
    if (callbackSymbol?.kind !== "const" || !callbackSymbol.initializer) return null;
    callbackSource = callbackSymbol.initializer;
  }
  const unwrappedCallbackSource = stripParenExpression(callbackSource);
  if (
    !isNodeOfType(unwrappedCallbackSource, "CallExpression") ||
    !isReactApiCall(unwrappedCallbackSource, "useCallback", scopes, {
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const callback = unwrappedCallbackSource.arguments?.[0];
  if (!callback || isNodeOfType(callback, "SpreadElement")) return null;
  return resolveExactLocalFunction(stripParenExpression(callback), scopes);
};

const bindingReadsExactGlobalLocationSnapshot = (
  bindingIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const symbol = scopes.symbolFor(bindingIdentifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const bindingScope =
    symbol.kind === "function" ? scopes.scopeFor(symbol.declarationNode) : symbol.scope;
  if (
    bindingScope.symbols.some(
      (candidateSymbol) =>
        candidateSymbol.name === symbol.name &&
        candidateSymbol.references.some((reference) => reference.flag !== "read"),
    )
  ) {
    return false;
  }
  const resolvedFunction = resolveExactLocalOrReactCallbackFunction(bindingIdentifier, scopes);
  const initializer = isFunctionLike(resolvedFunction)
    ? resolvedFunction.body
    : getDirectUnreassignedInitializer(symbol);
  if (!initializer) return false;

  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  if (containsGlobalLocationSnapshotRead(initializer, scopes)) return true;

  let didFindAliasedLocationSnapshotRead = false;
  walkAst(initializer, (child: EsTreeNode): boolean | void => {
    if (didFindAliasedLocationSnapshotRead) return false;
    if (
      child !== initializer &&
      isFunctionLike(child) &&
      !executesDuringRender(findTransparentExpressionRoot(child), scopes)
    ) {
      return false;
    }
    if (!isNodeOfType(child, "Identifier")) return;
    if (bindingReadsExactGlobalLocationSnapshot(child, scopes, nextVisitedSymbolIds)) {
      didFindAliasedLocationSnapshotRead = true;
      return false;
    }
  });
  return didFindAliasedLocationSnapshotRead;
};

const hasRenderReachableLocationSnapshotRead = (
  componentBody: EsTreeNodeOfType<"BlockStatement">,
  renderReachableExpressions: EsTreeNode[],
  directRenderNames: ReadonlySet<string>,
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
        directRenderNames.has(statement.id.name) &&
        bindingReadsExactGlobalLocationSnapshot(statement.id, scopes)
      ) {
        return true;
      }
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      if (!directRenderNames.has(declarator.id.name)) continue;
      if (bindingReadsExactGlobalLocationSnapshot(declarator.id, scopes)) return true;
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
  const functionExpressionRoot = findTransparentExpressionRoot(functionNode);
  if (!executesDuringRender(functionExpressionRoot, scopes)) return null;
  const parent = functionExpressionRoot.parent;
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
  const listenerFunction = resolveExactLocalOrReactCallbackFunction(listenerExpression, scopes);
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
    identifierCalls: new Set(),
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
        index.identifierCalls.add(child);
      }
      const calledFunction = resolveExactLocalOrReactCallbackFunction(child.callee, context.scopes);
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

const collectStableBooleanGuardConstraints = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode,
  scopes: ScopeAnalysis,
): Map<number, boolean | null> => {
  const constraintsBySymbolId = new Map<number, boolean | null>();
  const recordConstraint = (test: EsTreeNode, requiredTestValue: boolean): void => {
    let expression = stripParenExpression(test);
    let requiredValue = requiredTestValue;
    while (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
      requiredValue = !requiredValue;
      expression = stripParenExpression(expression.argument);
    }
    if (!isNodeOfType(expression, "Identifier")) return;
    const symbol = scopes.symbolFor(expression);
    if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return;
    const existingConstraint = constraintsBySymbolId.get(symbol.id);
    constraintsBySymbolId.set(
      symbol.id,
      existingConstraint === undefined || existingConstraint === requiredValue
        ? requiredValue
        : null,
    );
  };

  let current: EsTreeNode | null | undefined = node;
  while (current?.parent && current !== functionBoundary) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "IfStatement")) {
      if (parent.consequent === current) recordConstraint(parent.test, true);
      if (parent.alternate === current) recordConstraint(parent.test, false);
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent === current) recordConstraint(parent.test, true);
      if (parent.alternate === current) recordConstraint(parent.test, false);
    } else if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      if (parent.operator === "&&") recordConstraint(parent.left, true);
      if (parent.operator === "||") recordConstraint(parent.left, false);
    }
    if (current !== node && isFunctionLike(current)) break;
    current = parent;
  }
  return constraintsBySymbolId;
};

const haveContradictoryStableBooleanGuards = (
  firstNode: EsTreeNode,
  secondNode: EsTreeNode,
  functionBoundary: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const firstConstraints = collectStableBooleanGuardConstraints(
    firstNode,
    functionBoundary,
    scopes,
  );
  const secondConstraints = collectStableBooleanGuardConstraints(
    secondNode,
    functionBoundary,
    scopes,
  );
  for (const requiredValue of firstConstraints.values()) {
    if (requiredValue === null) return true;
  }
  for (const requiredValue of secondConstraints.values()) {
    if (requiredValue === null) return true;
  }
  for (const [symbolId, firstRequiredValue] of firstConstraints) {
    const secondRequiredValue = secondConstraints.get(symbolId);
    if (
      firstRequiredValue !== null &&
      secondRequiredValue !== undefined &&
      secondRequiredValue !== null &&
      firstRequiredValue !== secondRequiredValue
    ) {
      return true;
    }
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

const getTransparentExpressionBindingIdentifier = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const parent = expressionRoot.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === expressionRoot &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    return parent.left;
  }
  return null;
};

const getIntrinsicReactEventHandlerBindingIdentifier = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id;
  }
  const functionExpressionRoot = findTransparentExpressionRoot(functionNode);
  const directTransparentBindingIdentifier =
    getTransparentExpressionBindingIdentifier(functionExpressionRoot);
  if (directTransparentBindingIdentifier) return directTransparentBindingIdentifier;
  const callbackCall = functionExpressionRoot.parent;
  if (
    !isNodeOfType(callbackCall, "CallExpression") ||
    callbackCall.arguments?.[0] !== functionExpressionRoot ||
    !isReactApiCall(callbackCall, "useCallback", index.context.scopes, {
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  return getTransparentExpressionBindingIdentifier(callbackCall);
};

const isExclusiveIntrinsicReactEventHandler = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  const bindingIdentifier = getIntrinsicReactEventHandlerBindingIdentifier(functionNode, index);
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
  if (haveContradictoryStableBooleanGuards(sourceNode, targetNode, sourceOwner, context.scopes)) {
    return false;
  }
  if (isDescendantWithoutFunctionBoundary(targetNode, sourceNode)) return false;
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

const getInlineIntrinsicHandlerJsxElement = (functionNode: EsTreeNode): EsTreeNode | null => {
  let currentNode: EsTreeNode | null | undefined = functionNode;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "JSXAttribute") &&
      isEventHandlerAttribute(currentNode) &&
      isJsxAttributeOnIntrinsicHtmlElement(currentNode)
    ) {
      const openingElement = currentNode.parent;
      return isNodeOfType(openingElement?.parent, "JSXElement") ? openingElement.parent : null;
    }
    if (currentNode !== functionNode && isFunctionLike(currentNode)) return null;
    currentNode = currentNode.parent;
  }
  return null;
};

const isProvenNonEscapingVoidRead = (identifier: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  return (
    isNodeOfType(expressionRoot.parent, "UnaryExpression") &&
    expressionRoot.parent.operator === "void" &&
    expressionRoot.parent.argument === expressionRoot
  );
};

const getDirectReadonlyValueAliasSymbol = (
  referenceIdentifier: EsTreeNode,
  sourceSymbol: SymbolDescriptor,
  index: LocationInvalidationIndex,
): SymbolDescriptor | null => {
  const referenceRoot = findTransparentExpressionRoot(referenceIdentifier);
  const parent = referenceRoot.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === referenceRoot &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    const aliasSymbol = index.context.scopes.symbolFor(parent.id);
    const aliasInitializer = aliasSymbol ? getDirectConstInitializer(aliasSymbol) : null;
    const unwrappedInitializer = aliasInitializer ? stripParenExpression(aliasInitializer) : null;
    return aliasSymbol &&
      isNodeOfType(unwrappedInitializer, "Identifier") &&
      index.context.scopes.symbolFor(unwrappedInitializer) === sourceSymbol
      ? aliasSymbol
      : null;
  }
  if (
    !isNodeOfType(parent, "CallExpression") ||
    parent.arguments?.[0] !== referenceRoot ||
    !isReactApiCall(parent, "useCallback", index.context.scopes, {
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const callbackResultRoot = findTransparentExpressionRoot(parent);
  const resultParent = callbackResultRoot.parent;
  if (
    !isNodeOfType(resultParent, "VariableDeclarator") ||
    resultParent.init !== callbackResultRoot ||
    !isNodeOfType(resultParent.id, "Identifier")
  ) {
    return null;
  }
  const callbackResultSymbol = index.context.scopes.symbolFor(resultParent.id);
  return callbackResultSymbol &&
    getDirectConstInitializer(callbackResultSymbol) === callbackResultRoot
    ? callbackResultSymbol
    : null;
};

const isKnownAggregateMutationReference = (
  referenceIdentifier: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean => {
  const referenceRoot = findTransparentExpressionRoot(referenceIdentifier);
  const parent = referenceRoot.parent;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot) {
    const memberRoot = findTransparentExpressionRoot(parent);
    const callExpression = memberRoot.parent;
    const methodName = getStaticPropertyName(parent);
    if (
      isNodeOfType(callExpression, "CallExpression") &&
      callExpression.callee === memberRoot &&
      methodName !== null &&
      AGGREGATE_MUTATION_METHOD_NAMES.has(methodName)
    ) {
      return true;
    }
  }
  if (!isNodeOfType(parent, "CallExpression") || parent.arguments?.[0] !== referenceRoot) {
    return false;
  }
  const callee = stripParenExpression(parent.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (methodName === null) return false;
  return (
    (OBJECT_AGGREGATE_MUTATION_METHOD_NAMES.has(methodName) &&
      isProvenGlobalNamespaceReference(callee.object, "Object", index.context.scopes)) ||
    (REFLECT_AGGREGATE_MUTATION_METHOD_NAMES.has(methodName) &&
      isProvenGlobalNamespaceReference(callee.object, "Reflect", index.context.scopes))
  );
};

const collectExactReadonlyValueEscapeAnchors = (
  symbol: SymbolDescriptor,
  index: LocationInvalidationIndex,
  valueFunctionNode: EsTreeNode | null,
  options: ReadonlyValueEscapeOptions = {},
  visitedSymbolIds = new Set<number>(),
): EsTreeNode[] | null => {
  if (visitedSymbolIds.has(symbol.id)) return null;
  if (
    symbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        isWithinAssignmentTarget(reference.identifier) ||
        (options.rejectKnownMutations &&
          isKnownAggregateMutationReference(reference.identifier, index)),
    )
  ) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  const escapeAnchors: EsTreeNode[] = [];
  for (const reference of symbol.references) {
    if (
      (valueFunctionNode &&
        index.context.cfg.enclosingFunction(reference.identifier) === valueFunctionNode) ||
      isProvenNonEscapingVoidRead(reference.identifier)
    ) {
      continue;
    }
    const aliasSymbol = getDirectReadonlyValueAliasSymbol(reference.identifier, symbol, index);
    if (!aliasSymbol) {
      escapeAnchors.push(reference.identifier);
      continue;
    }
    const aliasEscapeAnchors = collectExactReadonlyValueEscapeAnchors(
      aliasSymbol,
      index,
      valueFunctionNode,
      options,
      nextVisitedSymbolIds,
    );
    if (!aliasEscapeAnchors) return null;
    escapeAnchors.push(...aliasEscapeAnchors);
  }
  return escapeAnchors.length > 0 ? escapeAnchors : null;
};

const findReadonlyJsxAggregateRoot = (jsxElement: EsTreeNode): EsTreeNode => {
  let aggregateRoot = findTransparentExpressionRoot(jsxElement);
  while (aggregateRoot.parent) {
    const parent = aggregateRoot.parent;
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children?.some((child) => child === aggregateRoot)
    ) {
      aggregateRoot = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "ArrayExpression") &&
      parent.elements?.some((element) => element === aggregateRoot)
    ) {
      aggregateRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.value === aggregateRoot &&
      parent.kind === "init" &&
      !parent.computed &&
      isNodeOfType(parent.parent, "ObjectExpression")
    ) {
      aggregateRoot = findTransparentExpressionRoot(parent.parent);
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === aggregateRoot || parent.alternate === aggregateRoot)
    ) {
      aggregateRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      (parent.right === aggregateRoot ||
        (parent.left === aggregateRoot && parent.operator !== "&&"))
    ) {
      aggregateRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "SequenceExpression") &&
      getFinalSequenceExpressionValue(parent) === getFinalSequenceExpressionValue(aggregateRoot)
    ) {
      aggregateRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  return aggregateRoot;
};

const getReadonlyJsxValueEscapeAnchors = (
  jsxElement: EsTreeNode,
  index: LocationInvalidationIndex,
): EsTreeNode[] | null => {
  const jsxValueRoot = findReadonlyJsxAggregateRoot(jsxElement);
  const parent = jsxValueRoot.parent;
  if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== jsxValueRoot) {
    return [jsxValueRoot];
  }
  if (!isNodeOfType(parent.id, "Identifier")) return null;
  const bindingSymbol = index.context.scopes.symbolFor(parent.id);
  if (!bindingSymbol || getDirectConstInitializer(bindingSymbol) !== jsxValueRoot) return null;
  return collectExactReadonlyValueEscapeAnchors(bindingSymbol, index, null, {
    rejectKnownMutations: true,
  });
};

const getExclusiveIntrinsicReactEventHandlerAnchors = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): EsTreeNode[] | null => {
  if (!isExclusiveIntrinsicReactEventHandler(functionNode, index)) return null;
  const bindingIdentifier = getIntrinsicReactEventHandlerBindingIdentifier(functionNode, index);
  if (!bindingIdentifier) {
    const jsxElement = getInlineIntrinsicHandlerJsxElement(functionNode);
    return jsxElement ? getReadonlyJsxValueEscapeAnchors(jsxElement, index) : null;
  }
  const bindingSymbol = index.context.scopes.symbolFor(bindingIdentifier);
  return bindingSymbol?.references.map((reference) => reference.identifier) ?? null;
};

const getReadonlyFunctionEscapeAnchors = (
  functionNode: EsTreeNode,
  index: LocationInvalidationIndex,
): EsTreeNode[] | null => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return null;
  const bindingSymbol = index.context.scopes.symbolFor(bindingIdentifier);
  if (
    !bindingSymbol ||
    resolveExactLocalFunction(bindingIdentifier, index.context.scopes) !== functionNode
  ) {
    return null;
  }
  return collectExactReadonlyValueEscapeAnchors(bindingSymbol, index, functionNode);
};

const isAliasInitializedBeforeExecution = (
  aliasDeclaration: EsTreeNode,
  executionNode: EsTreeNode,
  index: LocationInvalidationIndex,
  visitedFunctionNodes = new Set<EsTreeNode>(),
): boolean => {
  if (!isNodeReachableWithinFunction(aliasDeclaration, index.context)) return false;
  const aliasOwner = index.context.cfg.enclosingFunction(aliasDeclaration);
  const executionOwner = index.context.cfg.enclosingFunction(executionNode);
  if (!aliasOwner || !executionOwner) return false;
  if (aliasOwner === executionOwner) {
    return canNodeReachNode(aliasDeclaration, executionNode, index);
  }
  if (visitedFunctionNodes.has(executionOwner)) return false;
  const nextVisitedFunctionNodes = new Set(visitedFunctionNodes);
  nextVisitedFunctionNodes.add(executionOwner);
  if (
    aliasOwner === index.componentFunction &&
    (index.effectCallbacks.has(executionOwner) ||
      index.mountedListenerFunctions.has(executionOwner))
  ) {
    return doNodesCoverEveryPathFromFunctionEntry(
      index.componentFunction,
      [aliasDeclaration],
      index.context,
      { ignoreThrowEdges: true },
    );
  }
  const invocations = new Set([
    ...(index.callSitesByFunction.get(executionOwner) ?? []),
    ...(index.synchronousInvocationsByFunction.get(executionOwner) ?? []),
  ]);
  if (invocations.size > 0) {
    return [...invocations].every((invocation) =>
      isAliasInitializedBeforeExecution(
        aliasDeclaration,
        invocation,
        index,
        nextVisitedFunctionNodes,
      ),
    );
  }
  const deferredExecutionAnchors = getExclusiveIntrinsicReactEventHandlerAnchors(
    executionOwner,
    index,
  );
  if (deferredExecutionAnchors) {
    return deferredExecutionAnchors.every((anchor) =>
      isAliasInitializedBeforeExecution(aliasDeclaration, anchor, index, nextVisitedFunctionNodes),
    );
  }
  const functionEscapeAnchors = getReadonlyFunctionEscapeAnchors(executionOwner, index);
  return Boolean(
    functionEscapeAnchors?.every((anchor) =>
      isAliasInitializedBeforeExecution(aliasDeclaration, anchor, index, nextVisitedFunctionNodes),
    ),
  );
};

const resolveExactReadonlyCalleeSymbolId = (
  callExpression: EsTreeNode,
  index: LocationInvalidationIndex,
): number | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const visitedSymbolIds = new Set<number>();
  let symbol = index.context.scopes.symbolFor(callee);
  while (symbol) {
    if (visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return symbol.id;
    if (
      symbol.references.some(
        (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
      ) ||
      !isAliasInitializedBeforeExecution(symbol.declarationNode, callExpression, index)
    ) {
      return null;
    }
    const unwrappedInitializer = stripParenExpression(initializer);
    if (!isNodeOfType(unwrappedInitializer, "Identifier")) return symbol.id;
    const initializerSymbol = index.context.scopes.symbolFor(unwrappedInitializer);
    if (
      !initializerSymbol ||
      !isAliasInitializedBeforeExecution(
        initializerSymbol.declarationNode,
        symbol.declarationNode,
        index,
      )
    ) {
      return null;
    }
    symbol = initializerSymbol;
  }
  return null;
};

const collectExactReadonlyCalleeCalls = (index: LocationInvalidationIndex): void => {
  for (const callExpression of index.identifierCalls) {
    const calleeSymbolId = resolveExactReadonlyCalleeSymbolId(callExpression, index);
    if (calleeSymbolId !== null) {
      addToSetIndex(index.callsByCalleeSymbolId, calleeSymbolId, callExpression);
    }
  }
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

const canReactBatchMutationAfterExecution = (
  executionNode: EsTreeNode,
  mutationNode: EsTreeNode,
  owner: EsTreeNode,
  index: LocationInvalidationIndex,
): boolean =>
  (isExclusiveIntrinsicReactEventHandler(owner, index) || index.effectCallbacks.has(owner)) &&
  canNodeReachNode(executionNode, mutationNode, index) &&
  canExecuteBeforeAsyncSuspension(mutationNode, owner, index.context, {
    suspensionNodes: index.awaitExpressionsByOwner.get(owner),
  }) &&
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
      canExecuteBeforeAsyncSuspension(mutationExecution, functionNode, index.context, {
        suspensionNodes: index.awaitExpressionsByOwner.get(functionNode),
      }) && canNodeReachNormalFunctionExit(mutationExecution, functionNode, index),
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
    if (
      canExecuteBeforeAsyncSuspension(removal.callExpression, functionNode, index.context, {
        suspensionNodes: index.awaitExpressionsByOwner.get(functionNode),
      })
    ) {
      removalExecutions.push(removal.callExpression);
    }
  }
  for (const expression of index.expressionsByOwner.get(functionNode) ?? []) {
    const calledFunction = index.calledFunctionByExpression.get(expression);
    if (
      calledFunction &&
      canExecuteBeforeAsyncSuspension(expression, functionNode, index.context, {
        suspensionNodes: index.awaitExpressionsByOwner.get(functionNode),
      }) &&
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
      canExecuteBeforeAsyncSuspension(removal.callExpression, functionNode, index.context, {
        suspensionNodes: index.awaitExpressionsByOwner.get(functionNode),
      })
    ) {
      removalExecutions.add(removal.callExpression);
    }
  }
  for (const expression of index.expressionsByOwner.get(functionNode) ?? []) {
    const calledFunction = index.calledFunctionByExpression.get(expression);
    if (
      calledFunction &&
      canExecuteBeforeAsyncSuspension(expression, functionNode, index.context, {
        suspensionNodes: index.awaitExpressionsByOwner.get(functionNode),
      }) &&
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

const collectImpliedExpressionExecutionBoundaries = (
  node: EsTreeNode,
  owner: EsTreeNode,
): EsTreeNode[] => {
  const expressionBoundaries: EsTreeNode[] = [];
  let currentChild = node;
  let currentParent = currentChild.parent ?? null;
  while (currentParent && currentParent !== owner) {
    if (
      isNodeOfType(currentParent, "ConditionalExpression") &&
      currentParent.test === currentChild
    ) {
      const staticTestValue = readStaticBoolean(
        getFinalSequenceExpressionValue(currentParent.test),
      );
      if (staticTestValue !== null) {
        expressionBoundaries.push(
          staticTestValue ? currentParent.consequent : currentParent.alternate,
        );
      }
    }
    if (isNodeOfType(currentParent, "LogicalExpression") && currentParent.left === currentChild) {
      const staticLeftValue = readStaticBoolean(
        getFinalSequenceExpressionValue(currentParent.left),
      );
      if (
        (currentParent.operator === "&&" && staticLeftValue === true) ||
        (currentParent.operator === "||" && staticLeftValue === false)
      ) {
        expressionBoundaries.push(currentParent.right);
      }
    }
    if (
      (isNodeOfType(currentParent, "ConditionalExpression") &&
        (currentParent.consequent === currentChild || currentParent.alternate === currentChild)) ||
      (isNodeOfType(currentParent, "LogicalExpression") && currentParent.right === currentChild) ||
      (isNodeOfType(currentParent, "AssignmentPattern") && currentParent.right === currentChild)
    ) {
      expressionBoundaries.push(currentChild);
    }
    currentChild = currentParent;
    currentParent = currentChild.parent ?? null;
  }
  return expressionBoundaries;
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
  const expressionBoundaries = collectImpliedExpressionExecutionBoundaries(executionNode, owner);
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
    const removals = (matchingRemovalsByBlock.get(block) ?? []).filter((removal) => {
      if (block !== sourceBlock) return true;
      const removalStart = getRangeStart(removal);
      return sourceStart !== null && removalStart !== null && sourceStart < removalStart;
    });
    if (collectExpressionPathCoverageNodes(owner, removals, index.context).size > 0) {
      return true;
    }
    if (block !== sourceBlock) return false;
    return expressionBoundaries.some(
      (expressionBoundary) =>
        collectExpressionPathCoverageNodes(owner, removals, index.context, expressionBoundary)
          .size > 0,
    );
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
        canReactBatchMutationAfterExecution(executionAnchor, mutationExecution, owner, index),
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
  directRenderNames,
  renderReachableExpressions,
}: ExternalLocationInvalidationCheckerOptions): ExternalLocationInvalidationChecker => {
  if (
    !hasRenderReachableLocationSnapshotRead(
      componentBody,
      renderReachableExpressions,
      directRenderNames,
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
  collectExactReadonlyCalleeCalls(locationInvalidationIndex);
  return (setterBindingIdentifier) =>
    setterInvalidatesGlobalLocationSnapshot(setterBindingIdentifier, locationInvalidationIndex);
};
