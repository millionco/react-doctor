import {
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../constants/dom.js";
import {
  BOUND_RESOURCE_RELEASE_METHOD_NAMES,
  EFFECT_HOOK_NAMES,
  GLOBAL_RELEASE_METHOD_NAMES,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import {
  collectEffectInvokedFunctions,
  collectSynchronouslyEffectInvokedFunctions,
  getPromiseChainCallForCallback,
} from "../../utils/collect-effect-invoked-functions.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import {
  resolveReactRefCurrentOriginSymbol,
  resolveReactRefSymbol,
} from "../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getSubscribeOrObserveMethodName,
  isCleanupReturningSubscribeLikeCallExpression,
  isSubscribeOrObserveCallExpression,
  OBSERVER_REGISTRATION_METHOD_NAME,
} from "./utils/is-subscribe-like-call-expression.js";
import { resolveEventListenerCapture } from "./utils/resolve-event-listener-capture.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

const CLEANUP_EFFECT_HOOK_NAMES = new Set([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);
const REPLAYABLE_ITERATOR_COLLECTION_CACHE = new WeakMap<RuleContext, Map<number, string | null>>();

interface SubscribeLikeUsage {
  kind: "subscribe" | "timer" | "socket";
  node: EsTreeNode;
  resourceName: string;
  handleKey: string | null;
  receiverKey: string | null;
  registrationVerbName: string | null;
  eventKey: string | null;
  handlerKey: string | null;
}

interface RefOwnedHandlerStorage {
  handlerKey: string;
  refCurrentKey: string;
  refKey: string;
  assignmentNode: EsTreeNode;
}

interface RetainedDisposerStorage {
  assignmentNode: EsTreeNodeOfType<"AssignmentExpression">;
  refCurrentKey: string;
  retainedFunction:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">;
}

interface BooleanGuardState {
  bindingIdentifier: EsTreeNode | null;
  guardNode: EsTreeNode;
  key: string;
  value: boolean;
}

interface OwnedFunctionReference {
  generationKey: string | null;
}

interface GlobalReleaseProof {
  anchor: EsTreeNode;
  call: EsTreeNode;
  handleGuard: EsTreeNodeOfType<"IfStatement"> | null;
}

interface RetainedFunctionLeakOptions {
  allowReturnedResourceEscape?: boolean;
  allowReturnedTimerEscape?: boolean;
  includeOneShotTimers?: boolean;
  requireCallableReturnedResource?: boolean;
}

interface ReactRefEffectUsage {
  doesEffectOwnEveryResult: boolean;
}

interface ReactRefCallbackDefinition {
  assignmentNode: EsTreeNodeOfType<"AssignmentExpression">;
  functionNode:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">;
  refSymbol: SymbolDescriptor;
}

interface ReactRefEffectAnalysis {
  callbackDefinitionsByRefSymbolId: Map<number, ReactRefCallbackDefinition[]>;
  usageByRefSymbolId: Map<number, ReactRefEffectUsage>;
}

const REACT_REF_EFFECT_ANALYSIS_CACHE = new WeakMap<
  RuleContext,
  WeakMap<EsTreeNode, ReactRefEffectAnalysis>
>();

const RESOURCE_NOUN_BY_KIND = {
  subscribe: "subscription",
  timer: "timer",
  socket: "connection",
} as const;

const isSocketConstruction = (node: EsTreeNode): node is EsTreeNodeOfType<"NewExpression"> =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP.has(node.callee.name);

const resolveExpressionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (!symbol) {
      return context.scopes.isGlobalReference(unwrappedExpression)
        ? `global:${unwrappedExpression.name}`
        : null;
    }
    if (visitedSymbolIds.has(symbol.id)) return `symbol:${symbol.id}`;
    visitedSymbolIds.add(symbol.id);
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const variableDeclarator = bindingPattern?.parent;
    const bindingPropertyName = isNodeOfType(bindingProperty, "Property")
      ? getStaticPropertyKeyName(bindingProperty)
      : null;
    if (
      bindingPropertyName &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      isNodeOfType(variableDeclarator, "VariableDeclarator") &&
      variableDeclarator.id === bindingPattern
    ) {
      const objectKey = resolveExpressionKey(variableDeclarator.init, context, visitedSymbolIds);
      return objectKey ? `${objectKey}.${bindingPropertyName}` : `symbol:${symbol.id}`;
    }
    const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
    if (
      symbol.kind === "const" &&
      initializer &&
      (isNodeOfType(initializer, "Identifier") || isNodeOfType(initializer, "MemberExpression"))
    ) {
      return resolveExpressionKey(initializer, context, visitedSymbolIds) ?? `symbol:${symbol.id}`;
    }
    return `symbol:${symbol.id}`;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression") && !unwrappedExpression.computed) {
    if (!isNodeOfType(unwrappedExpression.property, "Identifier")) return null;
    const objectKey = resolveExpressionKey(unwrappedExpression.object, context, visitedSymbolIds);
    return objectKey ? `${objectKey}.${unwrappedExpression.property.name}` : null;
  }
  if (isNodeOfType(unwrappedExpression, "ThisExpression")) return "this";
  if (
    isNodeOfType(unwrappedExpression, "Literal") &&
    (typeof unwrappedExpression.value === "string" || typeof unwrappedExpression.value === "number")
  ) {
    return `literal:${String(unwrappedExpression.value)}`;
  }
  if (isFunctionLike(unwrappedExpression)) {
    const rangeStart = getRangeStart(unwrappedExpression);
    return rangeStart === null ? null : `function:${rangeStart}`;
  }
  return null;
};

const findAssignedResourceKey = (resourceNode: EsTreeNode, context: RuleContext): string | null => {
  let currentNode = resourceNode;
  let parentNode = currentNode.parent;
  while (isNodeOfType(parentNode, "ChainExpression")) {
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  if (isNodeOfType(parentNode, "VariableDeclarator") && parentNode.init === currentNode) {
    return resolveExpressionKey(parentNode.id, context);
  }
  if (isNodeOfType(parentNode, "AssignmentExpression") && parentNode.right === currentNode) {
    return resolveExpressionKey(parentNode.left, context);
  }
  return null;
};

const getCallRegistrationDetails = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): Pick<SubscribeLikeUsage, "receiverKey" | "registrationVerbName" | "eventKey" | "handlerKey"> => {
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return {
      receiverKey: null,
      registrationVerbName: null,
      eventKey: null,
      handlerKey: null,
    };
  }
  return {
    receiverKey: resolveExpressionKey(callee.object, context),
    registrationVerbName: callee.property.name,
    eventKey: resolveExpressionKey(callNode.arguments?.[0], context),
    handlerKey: resolveExpressionKey(callNode.arguments?.[1], context),
  };
};

const findSubscribeLikeUsages = (
  callback: EsTreeNode,
  context: RuleContext,
): SubscribeLikeUsage[] => {
  const usages: SubscribeLikeUsage[] = [];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return usages;
  }
  let cleanupArgument: EsTreeNode | null = null;
  if (isNodeOfType(callback.body, "BlockStatement")) {
    const callbackStatements = callback.body.body ?? [];
    const lastCallbackStatement = callbackStatements[callbackStatements.length - 1];
    if (isNodeOfType(lastCallbackStatement, "ReturnStatement") && lastCallbackStatement.argument) {
      cleanupArgument = lastCallbackStatement.argument;
    }
  }
  const effectInvokedFunctions = collectEffectInvokedFunctions(callback);

  walkAst(callback, (child: EsTreeNode) => {
    if (child !== callback && isFunctionLike(child)) {
      if (child === cleanupArgument) return false;
      if (!effectInvokedFunctions.has(child) && !isSynchronousIteratorCallback(child)) return false;
    }

    if (isSocketConstruction(child)) {
      usages.push({
        kind: "socket",
        node: child,
        resourceName: isNodeOfType(child.callee, "Identifier") ? child.callee.name : "WebSocket",
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: null,
        eventKey: null,
        handlerKey: null,
      });
      return;
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
    ) {
      usages.push({
        kind: "timer",
        node: child,
        resourceName: child.callee.name,
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: child.callee.name,
        eventKey: null,
        handlerKey: null,
      });
      return;
    }

    const subscribeOrObserveMethodName = getSubscribeOrObserveMethodName(child);
    if (subscribeOrObserveMethodName !== null) {
      const registrationDetails = getCallRegistrationDetails(child, context);
      usages.push({
        kind: "subscribe",
        node: child,
        resourceName: subscribeOrObserveMethodName,
        handleKey: findAssignedResourceKey(child, context),
        ...registrationDetails,
      });
    }
  });
  return usages.filter((usage) => isNodeReachableWithinFunction(usage.node, context));
};

const doMatchingNodesCoverEveryPathAfterUsage = (
  usageNode: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  let pathAnchor = usageNode;
  let pathOwner = findEnclosingFunction(pathAnchor);
  while (pathOwner && isSynchronousIteratorCallback(pathOwner)) {
    if (
      matchingNodes.length > 0 &&
      matchingNodes.every(
        (matchingNode) => context.cfg.enclosingFunction(matchingNode) === pathOwner,
      )
    ) {
      break;
    }
    const iteratorCall = pathOwner.parent;
    if (!isNodeOfType(iteratorCall, "CallExpression")) break;
    pathAnchor = iteratorCall;
    pathOwner = findEnclosingFunction(pathAnchor);
  }
  const owner = context.cfg.enclosingFunction(pathAnchor);
  if (!owner) return false;
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return false;
  const usageBlock = functionCfg.blockOf(pathAnchor);
  if (!usageBlock) return false;
  const usageStart = getRangeStart(usageNode);
  const matchingBlocks = new Set(
    matchingNodes.flatMap((matchingNode) => {
      if (context.cfg.enclosingFunction(matchingNode) !== owner) return [];
      const matchingBlock = functionCfg.blockOf(matchingNode);
      if (!matchingBlock) return [];
      const matchingStart = getRangeStart(matchingNode);
      if (
        matchingBlock === usageBlock &&
        usageStart !== null &&
        matchingStart !== null &&
        matchingStart < usageStart
      ) {
        return [];
      }
      return [matchingBlock];
    }),
  );
  if (matchingBlocks.has(usageBlock)) return true;
  const visitedBlocks = new Set([usageBlock]);
  const pendingBlocks = [usageBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (matchingBlocks.has(edge.to)) continue;
      if (edge.to === functionCfg.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return matchingBlocks.size > 0;
};

const doMatchingNodesCoverEveryPathFromFunctionEntry = (
  owner: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return false;
  const matchingBlocks = new Set(
    matchingNodes.flatMap((matchingNode) => {
      if (context.cfg.enclosingFunction(matchingNode) !== owner) return [];
      const matchingBlock = functionCfg.blockOf(matchingNode);
      return matchingBlock ? [matchingBlock] : [];
    }),
  );
  if (matchingBlocks.size === 0) return false;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (matchingBlocks.has(currentBlock)) continue;
    for (const edge of currentBlock.successors) {
      if (edge.to === functionCfg.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return true;
};

// A resource registered and then released SYNCHRONOUSLY later in the same
// effect body (`const socket = new WebSocket(url); …; socket.close();`,
// `observer.observe(el); measure(); observer.disconnect();`) never outlives
// the effect run, so it needs no cleanup return. Only statement-level
// releases count (a `.close()` inside a nested callback runs later, if
// ever), and only releases positioned AFTER the registration — a
// release-then-register pair (`emitter.off(...); emitter.on(...)`,
// debounce-style `clearTimeout(...); setTimeout(...)`) still leaks the
// trailing registration.
const removeSynchronouslyReleasedUsages = (
  callback: EsTreeNode,
  usages: SubscribeLikeUsage[],
  context: RuleContext,
): SubscribeLikeUsage[] => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return usages;
  }
  if (!isNodeOfType(callback.body, "BlockStatement")) return usages;
  const releaseCalls: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    const callNode = isNodeOfType(child, "ChainExpression") ? child.expression : child;
    if (!isNodeOfType(callNode, "CallExpression")) return;
    releaseCalls.push(child);
  });
  if (releaseCalls.length === 0) return usages;
  return usages.filter((usage) => {
    const usageStart = getRangeStart(usage.node);
    if (usageStart === null) return true;
    const matchingReleaseCalls = releaseCalls.filter((releaseCall) => {
      const releaseStart = getRangeStart(releaseCall);
      return (
        releaseStart !== null &&
        releaseStart > usageStart &&
        doesReleaseCallMatchUsage(releaseCall, usage, context)
      );
    });
    return !doMatchingNodesCoverEveryPathAfterUsage(usage.node, matchingReleaseCalls, context);
  });
};

const findForOfStatementForIteratorExpression = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNodeOfType<"ForOfStatement"> | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const bindingDeclarator = symbol?.bindingIdentifier.parent;
  const bindingDeclaration = bindingDeclarator?.parent;
  const forOfStatement = bindingDeclaration?.parent;
  const isStableIteratorBinding =
    isNodeOfType(bindingDeclaration, "VariableDeclaration") &&
    symbol?.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
  return symbol &&
    isNodeOfType(bindingDeclarator, "VariableDeclarator") &&
    bindingDeclarator.id === symbol.bindingIdentifier &&
    isStableIteratorBinding &&
    bindingDeclaration.declarations.length === 1 &&
    isNodeOfType(forOfStatement, "ForOfStatement") &&
    forOfStatement.left === bindingDeclaration &&
    forOfStatement.await !== true
    ? forOfStatement
    : null;
};

const isAssignmentFormForOfIteratorReference = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = stripParenExpression(expression);
  const referencedSymbolIds = new Set<number>();
  walkAst(unwrappedExpression, (expressionChild: EsTreeNode) => {
    if (!isNodeOfType(expressionChild, "Identifier")) return;
    const symbol = context.scopes.symbolFor(expressionChild);
    if (symbol) referencedSymbolIds.add(symbol.id);
  });
  if (referencedSymbolIds.size === 0) return false;
  const assignsReferencedSymbol = (root: EsTreeNode, requireAssignmentTarget: boolean): boolean => {
    let didAssignReferencedSymbol = false;
    walkAst(root, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "Identifier")) return;
      if (requireAssignmentTarget && !isWithinAssignmentTarget(child)) return;
      const childSymbol = context.scopes.symbolFor(child);
      if (childSymbol && referencedSymbolIds.has(childSymbol.id)) {
        didAssignReferencedSymbol = true;
        return false;
      }
    });
    return didAssignReferencedSymbol;
  };
  let currentNode = unwrappedExpression.parent;
  while (currentNode && !isFunctionLike(currentNode)) {
    if (isNodeOfType(currentNode, "ForOfStatement")) {
      const loopTarget = stripParenExpression(currentNode.left);
      if (
        !isNodeOfType(loopTarget, "VariableDeclaration") &&
        (assignsReferencedSymbol(loopTarget, false) ||
          assignsReferencedSymbol(currentNode.body, true))
      ) {
        return true;
      }
    }
    currentNode = currentNode.parent;
  }
  return false;
};

const isPrivatePlainConstIdentifier = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  return (
    !isNodeOfType(symbol.declarationNode.parent?.parent, "ExportNamedDeclaration") &&
    !isNodeOfType(symbol.declarationNode.parent?.parent, "ExportDefaultDeclaration")
  );
};

const hasOnlyReplayableCollectionReferences = (
  identifier: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (
    !isNodeOfType(identifier, "Identifier") ||
    !isPrivatePlainConstIdentifier(identifier, context)
  ) {
    return false;
  }
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return false;
  if (visitedSymbolIds.has(symbol.id)) return true;
  visitedSymbolIds.add(symbol.id);
  return symbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    if (isNodeOfType(parent, "ForOfStatement") && parent.right === referenceRoot) return true;
    if (isNodeOfType(parent, "VariableDeclarator") && parent.init === referenceRoot) {
      const declaration = parent.parent;
      return isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(declaration, "VariableDeclaration") &&
        declaration.kind === "const"
        ? hasOnlyReplayableCollectionReferences(parent.id, context, visitedSymbolIds)
        : false;
    }
    return false;
  });
};

const resolveReplayableIteratorCollectionKeyUncached = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "Identifier") ||
    !isPrivatePlainConstIdentifier(unwrappedExpression, context)
  ) {
    return null;
  }
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (isNodeOfType(initializer, "ArrayExpression")) {
    const hasOnlyPrimitiveElements = (initializer.elements ?? []).every(
      (element) =>
        element === null ||
        (isNodeOfType(element, "Literal") &&
          (element.value === null ||
            typeof element.value === "boolean" ||
            typeof element.value === "number" ||
            typeof element.value === "string")),
    );
    return hasOnlyPrimitiveElements &&
      hasOnlyReplayableCollectionReferences(symbol.bindingIdentifier, context, new Set())
      ? `symbol:${symbol.id}`
      : null;
  }
  if (!isNodeOfType(initializer, "Identifier")) return null;
  return resolveReplayableIteratorCollectionKeyUncached(initializer, context, visitedSymbolIds);
};

const resolveReplayableIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol) return null;
  let contextCache = REPLAYABLE_ITERATOR_COLLECTION_CACHE.get(context);
  if (!contextCache) {
    contextCache = new Map();
    REPLAYABLE_ITERATOR_COLLECTION_CACHE.set(context, contextCache);
  }
  if (contextCache.has(symbol.id)) return contextCache.get(symbol.id) ?? null;
  const collectionKey = resolveReplayableIteratorCollectionKeyUncached(expression, context);
  contextCache.set(symbol.id, collectionKey);
  return collectionKey;
};

const resolveIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const forOfStatement = findForOfStatementForIteratorExpression(unwrappedExpression, context);
  if (forOfStatement) {
    return resolveReplayableIteratorCollectionKey(forOfStatement.right, context);
  }
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || symbol.kind !== "parameter") return null;
  let callbackNode: EsTreeNode | null | undefined = symbol.bindingIdentifier.parent;
  while (callbackNode && !isFunctionLike(callbackNode)) callbackNode = callbackNode.parent;
  if (!callbackNode || !isFunctionLike(callbackNode)) return null;
  const callNode = callbackNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = stripParenExpression(callNode.callee);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    if (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Array" &&
      callee.property.name === "from" &&
      callNode.arguments?.[1] === callbackNode
    ) {
      return resolveExpressionKey(callNode.arguments[0], context);
    }
    if (callNode.arguments?.[0] === callbackNode) {
      return resolveExpressionKey(callee.object, context);
    }
  }
  return null;
};

const isStableLoopReceiver = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = stripParenExpression(expression);
  return (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "document" &&
    context.scopes.isGlobalReference(unwrappedExpression)
  );
};

const resolveStableLoopHandlerSymbolId = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): number | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    (symbol.kind !== "const" && symbol.kind !== "function" && symbol.kind !== "parameter") ||
    !symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return null;
  }
  return symbol.id;
};

const isDirectExhaustiveForOfRelease = (
  releaseNode: EsTreeNode,
  forOfStatement: EsTreeNodeOfType<"ForOfStatement">,
): boolean => {
  const releaseRoot = findTransparentExpressionRoot(releaseNode);
  const releaseStatement = releaseRoot.parent;
  if (!isNodeOfType(releaseStatement, "ExpressionStatement")) return false;
  const isDirectLoopBodyStatement = isNodeOfType(forOfStatement.body, "BlockStatement")
    ? releaseStatement.parent === forOfStatement.body
    : releaseStatement === forOfStatement.body;
  if (!isDirectLoopBodyStatement) return false;
  let hasAbruptLoopExit = false;
  walkAst(forOfStatement.body, (child: EsTreeNode) => {
    if (hasAbruptLoopExit) return false;
    if (child !== forOfStatement.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "BreakStatement") ||
      isNodeOfType(child, "ContinueStatement") ||
      isNodeOfType(child, "ReturnStatement") ||
      isNodeOfType(child, "ThrowStatement")
    ) {
      hasAbruptLoopExit = true;
      return false;
    }
  });
  return !hasAbruptLoopExit;
};

const findCollectionMappingCall = (callbackNode: EsTreeNode): EsTreeNode | null => {
  if (
    (!isNodeOfType(callbackNode, "ArrowFunctionExpression") &&
      !isNodeOfType(callbackNode, "FunctionExpression")) ||
    callbackNode.async ||
    callbackNode.generator
  ) {
    return null;
  }
  const callNode = callbackNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return null;
  }
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    callee.property.name === "from" &&
    callNode.arguments?.[1] === callbackNode
  ) {
    return callNode;
  }
  return callee.property.name === "map" && callNode.arguments?.[0] === callbackNode
    ? callNode
    : null;
};

const findMappedResourceCollectionKey = (
  resourceNode: EsTreeNode,
  context: RuleContext,
): string | null => {
  const callbackNode = findEnclosingFunction(resourceNode);
  if (
    !callbackNode ||
    (!isNodeOfType(callbackNode, "ArrowFunctionExpression") &&
      !isNodeOfType(callbackNode, "FunctionExpression"))
  ) {
    return null;
  }
  const mappingCall = findCollectionMappingCall(callbackNode);
  if (!mappingCall) return null;

  if (isNodeOfType(callbackNode.body, "BlockStatement")) {
    const resourceRoot = findTransparentExpressionRoot(resourceNode);
    const resourceDeclarator = resourceRoot.parent;
    const resourceDeclaration = resourceDeclarator?.parent;
    if (
      !isNodeOfType(resourceDeclarator, "VariableDeclarator") ||
      resourceDeclarator.init !== resourceRoot ||
      !isNodeOfType(resourceDeclarator.id, "Identifier") ||
      !isNodeOfType(resourceDeclaration, "VariableDeclaration") ||
      resourceDeclaration.kind !== "const" ||
      resourceDeclaration.parent !== callbackNode.body
    ) {
      return null;
    }

    const returnStatements: EsTreeNode[] = [];
    walkAst(callbackNode.body, (child: EsTreeNode) => {
      if (child !== callbackNode.body && isFunctionLike(child)) return false;
      if (isNodeOfType(child, "ReturnStatement")) returnStatements.push(child);
    });
    const returnStatement = returnStatements[0];
    const callbackStatements = callbackNode.body.body ?? [];
    const returnedIdentifier =
      isNodeOfType(returnStatement, "ReturnStatement") && returnStatement.argument
        ? stripParenExpression(returnStatement.argument)
        : null;
    const resourceSymbol = context.scopes.symbolFor(resourceDeclarator.id);
    if (
      returnStatements.length !== 1 ||
      callbackStatements[callbackStatements.length - 1] !== returnStatement ||
      !isNodeOfType(returnedIdentifier, "Identifier") ||
      !resourceSymbol ||
      context.scopes.symbolFor(returnedIdentifier)?.id !== resourceSymbol.id ||
      !doMatchingNodesCoverEveryPathAfterUsage(resourceNode, [returnStatement], context)
    ) {
      return null;
    }
  } else if (findTransparentExpressionRoot(resourceNode) !== callbackNode.body) {
    return null;
  }

  const mappingRoot = findTransparentExpressionRoot(mappingCall);
  const collectionDeclarator = mappingRoot.parent;
  return isNodeOfType(collectionDeclarator, "VariableDeclarator") &&
    collectionDeclarator.init === mappingRoot
    ? resolveExpressionKey(collectionDeclarator.id, context)
    : null;
};

const findContainingCollectionKey = (
  resourceNode: EsTreeNode,
  context: RuleContext,
): string | null => {
  const mappedCollectionKey = findMappedResourceCollectionKey(resourceNode, context);
  if (mappedCollectionKey !== null) return mappedCollectionKey;
  let currentNode = resourceNode;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode)) return null;
    if (isNodeOfType(parentNode, "VariableDeclarator") && parentNode.init === currentNode) {
      return resolveExpressionKey(parentNode.id, context);
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return null;
};

const findPushedResourceCollectionKey = (
  usage: SubscribeLikeUsage,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(usage.node, "CallExpression")) return null;
  const registrationCallee = stripParenExpression(usage.node.callee);
  if (!isNodeOfType(registrationCallee, "MemberExpression") || registrationCallee.computed) {
    return null;
  }
  const resourceIdentifier = stripParenExpression(registrationCallee.object);
  if (!isPrivatePlainConstIdentifier(resourceIdentifier, context)) return null;
  const resourceSymbol = context.scopes.symbolFor(resourceIdentifier);
  if (!resourceSymbol) return null;

  const pushCalls = resourceSymbol.references.flatMap((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const callNode = referenceRoot.parent;
    if (
      !isNodeOfType(callNode, "CallExpression") ||
      !callNode.arguments?.some((argument) => argument === referenceRoot)
    ) {
      return [];
    }
    const pushCallee = stripParenExpression(callNode.callee);
    return isNodeOfType(pushCallee, "MemberExpression") &&
      !pushCallee.computed &&
      isNodeOfType(pushCallee.object, "Identifier") &&
      isNodeOfType(pushCallee.property, "Identifier") &&
      pushCallee.property.name === "push"
      ? [callNode]
      : [];
  });
  if (pushCalls.length !== 1) return null;
  const pushCall = pushCalls[0];
  if (
    findEnclosingFunction(pushCall) !== findEnclosingFunction(usage.node) ||
    !doMatchingNodesCoverEveryPathAfterUsage(usage.node, [pushCall], context)
  ) {
    return null;
  }

  const pushCallee = stripParenExpression(pushCall.callee);
  if (
    !isNodeOfType(pushCallee, "MemberExpression") ||
    !isNodeOfType(pushCallee.object, "Identifier") ||
    !isPrivatePlainConstIdentifier(pushCallee.object, context)
  ) {
    return null;
  }
  const collectionSymbol = context.scopes.symbolFor(pushCallee.object);
  const collectionInitializer = collectionSymbol?.initializer
    ? stripParenExpression(collectionSymbol.initializer)
    : null;
  if (
    !collectionSymbol ||
    !isNodeOfType(collectionInitializer, "ArrayExpression") ||
    (collectionInitializer.elements?.length ?? 0) !== 0 ||
    findEnclosingFunction(collectionSymbol.declarationNode) !== findEnclosingFunction(usage.node)
  ) {
    return null;
  }
  const hasOnlyCollectionRetentionAndIteration = collectionSymbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const forOfStatement = referenceRoot.parent;
    if (
      isNodeOfType(forOfStatement, "ForOfStatement") &&
      forOfStatement.right === referenceRoot &&
      forOfStatement.await !== true
    ) {
      return true;
    }
    const memberNode = referenceRoot.parent;
    const callNode = memberNode?.parent;
    if (
      !isNodeOfType(memberNode, "MemberExpression") ||
      memberNode.object !== referenceRoot ||
      memberNode.computed ||
      !isNodeOfType(memberNode.property, "Identifier") ||
      !isNodeOfType(callNode, "CallExpression") ||
      callNode.callee !== memberNode
    ) {
      return false;
    }
    return memberNode.property.name === "forEach" || memberNode.property.name === "push";
  });
  return hasOnlyCollectionRetentionAndIteration
    ? resolveExpressionKey(pushCallee.object, context)
    : null;
};

const isWithinAssignmentTarget = (identifier: EsTreeNode): boolean => {
  let currentNode = identifier;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "AssignmentExpression")) {
      return parentNode.left === currentNode;
    }
    if (
      isNodeOfType(parentNode, "UpdateExpression") ||
      (isNodeOfType(parentNode, "UnaryExpression") && parentNode.operator === "delete")
    ) {
      return parentNode.argument === currentNode;
    }
    if (isNodeOfType(parentNode, "ForInStatement") || isNodeOfType(parentNode, "ForOfStatement")) {
      return parentNode.left === currentNode;
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const resolveStableValue = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return unwrappedExpression;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const isUnreassignedMutableBinding =
    (symbol?.kind === "let" || symbol?.kind === "var") &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ) &&
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length === 1;
  const recursiveFunctionSymbol =
    symbol?.kind === "function" && isFunctionLike(symbol.declarationNode)
      ? context.scopes
          .ownScopeFor(symbol.declarationNode)
          ?.symbols.find(
            (candidate) =>
              candidate.name === symbol.name &&
              candidate.declarationNode === symbol.declarationNode,
          )
      : null;
  const isUnreassignedFunctionBinding =
    symbol?.kind === "function" &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ) &&
    (!recursiveFunctionSymbol ||
      recursiveFunctionSymbol.references.every(
        (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
      )) &&
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length === 1;
  if (
    !symbol ||
    (symbol.kind !== "const" && !isUnreassignedMutableBinding && !isUnreassignedFunctionBinding) ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return unwrappedExpression;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveStableValue(symbol.initializer, context, visitedSymbolIds);
};

const resolveObjectExpression = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const resolvedExpression = resolveStableValue(expression, context);
  return isNodeOfType(resolvedExpression, "ObjectExpression") ? resolvedExpression : null;
};

const getListenerAbortControllerKey = (
  usage: SubscribeLikeUsage,
  context: RuleContext,
): string | null => {
  if (
    usage.registrationVerbName !== "addEventListener" ||
    !isNodeOfType(usage.node, "CallExpression")
  ) {
    return null;
  }
  const optionsArgument = usage.node.arguments?.[2];
  const optionsObject = resolveObjectExpression(optionsArgument, context);
  if (!optionsObject) return null;
  for (const property of optionsObject.properties ?? []) {
    if (!isNodeOfType(property, "Property") || getStaticPropertyKeyName(property) !== "signal") {
      continue;
    }
    const signalKey = resolveExpressionKey(property.value, context);
    return signalKey?.endsWith(".signal") ? signalKey.slice(0, -".signal".length) : null;
  }
  return null;
};

const SYNCHRONOUS_ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

const isSynchronousIteratorCallback = (functionNode: EsTreeNode): boolean => {
  const callNode = functionNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    callee.property.name === "from"
  ) {
    return callNode.arguments?.[1] === functionNode;
  }
  return (
    SYNCHRONOUS_ITERATOR_METHOD_NAMES.has(callee.property.name) &&
    callNode.arguments?.[0] === functionNode
  );
};

const findEnclosingForEachCall = (node: EsTreeNode): EsTreeNode | null => {
  const callbackNode = findEnclosingFunction(node);
  if (!callbackNode) return null;
  const callNode = callbackNode.parent;
  if (!isNodeOfType(callNode, "CallExpression") || callNode.arguments?.[0] !== callbackNode) {
    return null;
  }
  const callee = stripParenExpression(callNode.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "forEach"
    ? callNode
    : null;
};

const findDirectCallForReference = (identifier: EsTreeNode): EsTreeNode | null => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const callNode = expressionRoot.parent;
  return isNodeOfType(callNode, "CallExpression") && callNode.callee === expressionRoot
    ? callNode
    : null;
};

const findSingleDirectInvocation = (
  functionNode: EsTreeNode,
  caller: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier || resolveStableValue(bindingIdentifier, context) !== functionNode) {
    return null;
  }
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return null;
  const invocationCalls = symbol.references.flatMap((reference) => {
    const callNode = findDirectCallForReference(reference.identifier);
    return callNode ? [callNode] : [];
  });
  if (invocationCalls.length !== 1 || symbol.references.length !== 1) return null;
  const invocationCall = invocationCalls[0];
  return findEnclosingFunction(invocationCall) === caller &&
    isNodeReachableWithinFunction(invocationCall, context)
    ? invocationCall
    : null;
};

const resolveCleanupPathAnchor = (
  usageNode: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): EsTreeNode => {
  const usageFunction = findEnclosingFunction(usageNode);
  if (!usageFunction || usageFunction === effectCallback) return usageNode;
  return findSingleDirectInvocation(usageFunction, effectCallback, context) ?? usageNode;
};

const resolveSingleAssignedCleanupFunction = (
  expression: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  if (
    !symbol ||
    (symbol.kind !== "let" && symbol.kind !== "var") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !isNodeOfType(initializer, "Literal") ||
    initializer.value !== null ||
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length !== 1
  ) {
    return null;
  }
  const assignmentReferences = symbol.references.filter((reference) =>
    isWithinAssignmentTarget(reference.identifier),
  );
  if (assignmentReferences.length !== 1) return null;
  const assignmentReference = assignmentReferences[0];
  const assignmentTarget = findTransparentExpressionRoot(assignmentReference.identifier);
  const assignmentNode = assignmentTarget.parent;
  if (
    !isNodeOfType(assignmentNode, "AssignmentExpression") ||
    assignmentNode.operator !== "=" ||
    assignmentNode.left !== assignmentTarget ||
    findEnclosingFunction(assignmentNode) !== findEnclosingFunction(usage.node) ||
    !doMatchingNodesCoverEveryPathAfterUsage(usage.node, [assignmentNode], context)
  ) {
    return null;
  }
  const assignedValue = stripParenExpression(assignmentNode.right);
  return isFunctionLike(assignedValue) ? assignedValue : null;
};

const doesCleanupFunctionReleaseUsage = (
  cleanupFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): boolean => {
  if (!isFunctionLike(cleanupFunction) || visitedFunctions.has(cleanupFunction)) return false;
  visitedFunctions.add(cleanupFunction);
  let didCleanupFunctionMatch = false;
  const matchingLoopOrHelperAnchors: EsTreeNode[] = [];
  walkAst(cleanupFunction.body, (cleanupChild: EsTreeNode) => {
    if (didCleanupFunctionMatch) return false;
    if (
      cleanupChild !== cleanupFunction.body &&
      isFunctionLike(cleanupChild) &&
      !isSynchronousIteratorCallback(cleanupChild)
    ) {
      return false;
    }
    const cleanupCall = isNodeOfType(cleanupChild, "ChainExpression")
      ? cleanupChild.expression
      : cleanupChild;
    if (doesReleaseCallMatchUsage(cleanupChild, usage, context)) {
      const cleanupForEachCall = findEnclosingForEachCall(cleanupChild);
      const cleanupCallee = isNodeOfType(cleanupCall, "CallExpression")
        ? stripParenExpression(cleanupCall.callee)
        : null;
      const cleanupReceiverForOfStatement = isNodeOfType(cleanupCallee, "MemberExpression")
        ? findForOfStatementForIteratorExpression(cleanupCallee.object, context)
        : null;
      const cleanupReceiverCollectionKey = cleanupReceiverForOfStatement
        ? resolveExpressionKey(cleanupReceiverForOfStatement.right, context)
        : isNodeOfType(cleanupCallee, "MemberExpression")
          ? resolveIteratorCollectionKey(cleanupCallee.object, context)
          : null;
      if (
        cleanupReceiverCollectionKey !== null &&
        findEnclosingFunction(cleanupChild) !== cleanupFunction
      ) {
        if (
          cleanupForEachCall &&
          findPushedResourceCollectionKey(usage, context) === cleanupReceiverCollectionKey
        ) {
          matchingLoopOrHelperAnchors.push(cleanupForEachCall);
        }
        return;
      }
      const cleanupEventArgument = isNodeOfType(cleanupCall, "CallExpression")
        ? cleanupCall.arguments?.[0]
        : null;
      const cleanupForOfStatement =
        findForOfStatementForIteratorExpression(cleanupEventArgument, context) ??
        cleanupReceiverForOfStatement;
      if (!cleanupForOfStatement) {
        didCleanupFunctionMatch = true;
        return false;
      }
      if (
        !cleanupFunction.async &&
        !cleanupFunction.generator &&
        isDirectExhaustiveForOfRelease(cleanupChild, cleanupForOfStatement)
      ) {
        matchingLoopOrHelperAnchors.push(cleanupForOfStatement);
      }
      return;
    }
    if (!isNodeOfType(cleanupCall, "CallExpression")) return;
    const stableHelperFunction = resolveStableValue(cleanupCall.callee, context);
    const helperFunction = isNodeOfType(stableHelperFunction, "Identifier")
      ? resolveSingleAssignedCleanupFunction(stableHelperFunction, usage, context)
      : stableHelperFunction;
    if (
      helperFunction &&
      isFunctionLike(helperFunction) &&
      !helperFunction.async &&
      !helperFunction.generator &&
      doesCleanupFunctionReleaseUsage(helperFunction, usage, context, new Set(visitedFunctions))
    ) {
      matchingLoopOrHelperAnchors.push(cleanupCall);
    }
  });
  return (
    didCleanupFunctionMatch ||
    doMatchingNodesCoverEveryPathFromFunctionEntry(
      cleanupFunction,
      matchingLoopOrHelperAnchors,
      context,
    )
  );
};

const doesBoundCleanupReleaseUsage = (
  expression: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const callExpression = stripParenExpression(expression);
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const bindCallee = stripParenExpression(callExpression.callee);
  if (
    !isNodeOfType(bindCallee, "MemberExpression") ||
    bindCallee.computed ||
    !isNodeOfType(bindCallee.property, "Identifier") ||
    bindCallee.property.name !== "bind"
  ) {
    return false;
  }
  const releaseMember = stripParenExpression(bindCallee.object);
  if (
    !isNodeOfType(releaseMember, "MemberExpression") ||
    releaseMember.computed ||
    !isNodeOfType(releaseMember.property, "Identifier")
  ) {
    return false;
  }
  const releaseReceiverKey = resolveExpressionKey(releaseMember.object, context);
  if (
    releaseReceiverKey === null ||
    releaseReceiverKey !== resolveExpressionKey(callExpression.arguments?.[0], context)
  ) {
    return false;
  }
  const releaseVerbName = releaseMember.property.name;
  if (usage.kind === "socket") {
    return (
      usage.handleKey === releaseReceiverKey &&
      (SOCKET_RELEASE_VERB_NAMES.has(releaseVerbName) ||
        UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName))
    );
  }
  return (
    usage.kind === "subscribe" &&
    usage.handleKey === releaseReceiverKey &&
    (releaseVerbName === "unsubscribe" ||
      releaseVerbName === "unsub" ||
      releaseVerbName === "close" ||
      releaseVerbName === "unwatch" ||
      releaseVerbName === "unlisten" ||
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(releaseVerbName))
  );
};

const callbackReturnsCleanupForUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  if (callback.async) return false;
  const doesReturnedValueReleaseUsage = (returnedValue: EsTreeNode): boolean => {
    if (doesBoundCleanupReleaseUsage(returnedValue, usage, context)) return true;
    const cleanupFunction = resolveStableValue(returnedValue, context);
    if (cleanupFunction && doesBoundCleanupReleaseUsage(cleanupFunction, usage, context)) {
      return true;
    }
    return Boolean(
      cleanupFunction &&
      isFunctionLike(cleanupFunction) &&
      doesCleanupFunctionReleaseUsage(cleanupFunction, usage, context),
    );
  };
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return doesReturnedValueReleaseUsage(stripParenExpression(callback.body));
  }
  const matchingCleanupReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      doesReturnedValueReleaseUsage(stripParenExpression(child.argument))
    ) {
      matchingCleanupReturns.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathFromFunctionEntry(callback, matchingCleanupReturns, context);
};

const doesTestRequireLiveExpressionKey = (
  test: EsTreeNode,
  expressionKey: string,
  context: RuleContext,
): boolean => {
  if (resolveExpressionKey(test, context) === expressionKey) return true;
  const unwrappedTest = stripParenExpression(test);
  if (
    !isNodeOfType(unwrappedTest, "BinaryExpression") ||
    (unwrappedTest.operator !== "!=" && unwrappedTest.operator !== "!==")
  ) {
    return false;
  }
  const isNullishOperand = (operand: EsTreeNode): boolean => {
    const unwrappedOperand = stripParenExpression(operand);
    return (
      (isNodeOfType(unwrappedOperand, "Literal") && unwrappedOperand.value === null) ||
      (isNodeOfType(unwrappedOperand, "Identifier") &&
        unwrappedOperand.name === "undefined" &&
        context.scopes.isGlobalReference(unwrappedOperand))
    );
  };
  return (
    (resolveExpressionKey(unwrappedTest.left, context) === expressionKey &&
      isNullishOperand(unwrappedTest.right)) ||
    (resolveExpressionKey(unwrappedTest.right, context) === expressionKey &&
      isNullishOperand(unwrappedTest.left))
  );
};

const findLiveExpressionGuardForRelease = (
  releaseCall: EsTreeNode,
  owner: EsTreeNode,
  expressionKey: string,
  context: RuleContext,
): EsTreeNodeOfType<"IfStatement"> | null => {
  let ancestor = releaseCall.parent;
  while (ancestor && ancestor !== owner) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (
        ancestor.alternate !== null ||
        !doesTestRequireLiveExpressionKey(ancestor.test, expressionKey, context) ||
        !doMatchingNodesCoverEveryPathAfterUsage(ancestor.consequent, [releaseCall], context)
      ) {
        return null;
      }
      return ancestor;
    }
    ancestor = ancestor.parent;
  }
  return null;
};

const findDirectHandleGuardForRelease = (
  releaseCall: EsTreeNode,
  owner: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): EsTreeNodeOfType<"IfStatement"> | null =>
  usage.handleKey === null
    ? null
    : findLiveExpressionGuardForRelease(releaseCall, owner, usage.handleKey, context);

const hasRerunReleaseBeforeUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return false;
  }
  const functionCfg = context.cfg.cfgFor(callback);
  const usageBlock = functionCfg?.blockOf(usage.node);
  const usageStart = getRangeStart(usage.node);
  if (!functionCfg || !usageBlock || usageStart === null) return false;
  const matchingReleaseAnchors: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const releaseStart = getRangeStart(child);
    const handleGuard = findDirectHandleGuardForRelease(child, callback, usage, context);
    if (
      releaseStart === null ||
      releaseStart >= usageStart ||
      (functionCfg.blockOf(child) !== usageBlock && !handleGuard)
    ) {
      return;
    }
    if (doesReleaseCallMatchUsage(child, usage, context)) {
      matchingReleaseAnchors.push(handleGuard ?? child);
      return;
    }
    const helperFunction = resolveStableValue(child.callee, context);
    if (
      helperFunction &&
      isFunctionLike(helperFunction) &&
      doesCleanupFunctionReleaseUsage(helperFunction, usage, context)
    ) {
      matchingReleaseAnchors.push(handleGuard ?? child);
    }
  });
  return doMatchingNodesCoverEveryPathFromFunctionEntry(callback, matchingReleaseAnchors, context);
};

const hasStableUnmountCleanupForUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const componentFunction = findEnclosingFunction(callback);
  if (
    !componentFunction ||
    (!isNodeOfType(componentFunction, "ArrowFunctionExpression") &&
      !isNodeOfType(componentFunction, "FunctionExpression") &&
      !isNodeOfType(componentFunction, "FunctionDeclaration"))
  ) {
    return false;
  }
  let didFindUnmountCleanup = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (didFindUnmountCleanup) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction
    ) {
      return;
    }
    if (!isReactHookCall(child, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)) return;
    const dependencyList = child.arguments?.[1];
    if (!isNodeOfType(dependencyList, "ArrayExpression") || dependencyList.elements.length > 0) {
      return;
    }
    const cleanupCallback = getEffectCallback(child);
    if (
      cleanupCallback &&
      cleanupCallback !== callback &&
      callbackReturnsCleanupForUsage(cleanupCallback, usage, context)
    ) {
      didFindUnmountCleanup = true;
      return false;
    }
  });
  return didFindUnmountCleanup;
};

const hasSplitLifecycleCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  usage.handleKey !== null &&
  hasRerunReleaseBeforeUsage(callback, usage, context) &&
  hasStableUnmountCleanupForUsage(callback, usage, context);

const collectBlockingBooleanStates = (
  expression: EsTreeNode,
  blockedExpressionValue: boolean,
  guardNode: EsTreeNode,
  context: RuleContext,
): BooleanGuardState[] => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return collectBlockingBooleanStates(
      unwrappedExpression.argument,
      !blockedExpressionValue,
      guardNode,
      context,
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    const canEitherOperandBlock =
      (unwrappedExpression.operator === "||" && blockedExpressionValue) ||
      (unwrappedExpression.operator === "&&" && !blockedExpressionValue);
    if (!canEitherOperandBlock) return [];
    return [
      ...collectBlockingBooleanStates(
        unwrappedExpression.left,
        blockedExpressionValue,
        guardNode,
        context,
      ),
      ...collectBlockingBooleanStates(
        unwrappedExpression.right,
        blockedExpressionValue,
        guardNode,
        context,
      ),
    ];
  }
  if (
    isNodeOfType(unwrappedExpression, "BinaryExpression") &&
    ["===", "==", "!==", "!="].includes(unwrappedExpression.operator)
  ) {
    const leftValue = readStaticBoolean(unwrappedExpression.left);
    const rightValue = readStaticBoolean(unwrappedExpression.right);
    const booleanValue = leftValue ?? rightValue;
    const comparedExpression =
      leftValue === null ? unwrappedExpression.left : unwrappedExpression.right;
    const comparedKey = resolveExpressionKey(comparedExpression, context);
    if (booleanValue === null || comparedKey === null) return [];
    const isEquality =
      unwrappedExpression.operator === "===" || unwrappedExpression.operator === "==";
    return [
      {
        bindingIdentifier: isNodeOfType(comparedExpression, "Identifier")
          ? (context.scopes.symbolFor(comparedExpression)?.bindingIdentifier ?? null)
          : null,
        guardNode,
        key: comparedKey,
        value: isEquality === blockedExpressionValue ? booleanValue : !booleanValue,
      },
    ];
  }
  const expressionKey = resolveExpressionKey(unwrappedExpression, context);
  return expressionKey === null
    ? []
    : [
        {
          bindingIdentifier: isNodeOfType(unwrappedExpression, "Identifier")
            ? (context.scopes.symbolFor(unwrappedExpression)?.bindingIdentifier ?? null)
            : null,
          guardNode,
          key: expressionKey,
          value: blockedExpressionValue,
        },
      ];
};

const canNodeReachLaterNodeWithinFunction = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const functionCfg = context.cfg.cfgFor(owner);
  const sourceBlock = functionCfg?.blockOf(sourceNode);
  const targetBlock = functionCfg?.blockOf(targetNode);
  const sourceStart = getRangeStart(sourceNode);
  const targetStart = getRangeStart(targetNode);
  if (
    !functionCfg ||
    !sourceBlock ||
    !targetBlock ||
    sourceStart === null ||
    targetStart === null
  ) {
    return true;
  }
  if (!isNodeReachableWithinFunction(sourceNode, context)) return false;
  if (sourceBlock === targetBlock) return sourceStart < targetStart;
  const visitedBlocks = new Set([sourceBlock]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (edge.to === targetBlock) return true;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const collectDeferredUsageGuardStates = (
  callback: EsTreeNode,
  usageNode: EsTreeNode,
  context: RuleContext,
): BooleanGuardState[] => {
  if (!isFunctionLike(callback) || callback.async) return [];
  const guardStates: BooleanGuardState[] = [];
  walkAst(callback.body, (child: EsTreeNode) => {
    if (child !== callback.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "IfStatement") &&
      !child.alternate &&
      !canNodeReachLaterNodeWithinFunction(child.consequent, usageNode, callback, context) &&
      doMatchingNodesCoverEveryPathBeforeUsage(usageNode, [child], callback, context)
    ) {
      guardStates.push(...collectBlockingBooleanStates(child.test, true, child, context));
    }
  });
  let descendant = usageNode;
  let ancestor = descendant.parent;
  while (ancestor && ancestor !== callback) {
    if (isNodeOfType(ancestor, "IfStatement") && ancestor.consequent === descendant) {
      guardStates.push(...collectBlockingBooleanStates(ancestor.test, false, ancestor, context));
    }
    descendant = ancestor;
    ancestor = ancestor.parent;
  }
  return guardStates;
};

const cleanupReturnInvalidatesGuard = (
  cleanupReturn: EsTreeNode,
  guardState: BooleanGuardState,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
  const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
  if (
    !cleanupFunction ||
    !isFunctionLike(cleanupFunction) ||
    cleanupFunction.async ||
    cleanupFunction.generator
  ) {
    return false;
  }
  let didInvalidateGuard = false;
  walkAst(cleanupFunction.body, (child: EsTreeNode) => {
    if (didInvalidateGuard) return false;
    if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      resolveExpressionKey(child.left, context) === guardState.key &&
      readStaticBoolean(child.right) === guardState.value &&
      context.cfg.isUnconditionalFromEntry(child)
    ) {
      didInvalidateGuard = true;
      return false;
    }
  });
  return didInvalidateGuard;
};

const deferredUsageWritesGuardBeforeUsage = (
  callback: EsTreeNode,
  usageNode: EsTreeNode,
  guardState: BooleanGuardState,
  context: RuleContext,
): boolean => {
  const usageStart = getRangeStart(usageNode);
  if (!isFunctionLike(callback) || usageStart === null) return true;
  let didWriteGuard = false;
  walkAst(callback.body, (child: EsTreeNode) => {
    if (didWriteGuard) return false;
    if (child !== callback.body && isFunctionLike(child)) return false;
    const childStart = getRangeStart(child);
    if (childStart === null || childStart >= usageStart) return;
    const writtenExpression = isNodeOfType(child, "AssignmentExpression")
      ? child.left
      : isNodeOfType(child, "UpdateExpression")
        ? child.argument
        : null;
    if (writtenExpression && resolveExpressionKey(writtenExpression, context) === guardState.key) {
      didWriteGuard = true;
      return false;
    }
  });
  return didWriteGuard;
};

const canInterruptionReachUsageThroughCatch = (
  interruptionNode: EsTreeNode,
  usageNode: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let descendant = interruptionNode;
  let ancestor = descendant.parent;
  while (ancestor && ancestor !== owner) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === descendant &&
      ancestor.handler &&
      canNodeReachLaterNodeWithinFunction(ancestor.handler.body, usageNode, owner, context)
    ) {
      return true;
    }
    descendant = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};

const isEffectLocalLifecycleGuard = (
  callback: EsTreeNode,
  guardState: BooleanGuardState,
  cleanupFunctions: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  if (!guardState.bindingIdentifier) return false;
  const guardSymbol = context.scopes.symbolFor(guardState.bindingIdentifier);
  if (
    !guardSymbol ||
    (guardSymbol.kind !== "let" && guardSymbol.kind !== "var") ||
    !isNodeOfType(guardSymbol.declarationNode, "VariableDeclarator") ||
    findEnclosingFunction(guardSymbol.declarationNode) !== callback
  ) {
    return false;
  }
  return guardSymbol.references.every((reference) => {
    if (!isWithinAssignmentTarget(reference.identifier)) return true;
    const assignmentTarget = findTransparentExpressionRoot(reference.identifier);
    const assignment = assignmentTarget.parent;
    return (
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === assignmentTarget &&
      readStaticBoolean(assignment.right) === guardState.value &&
      cleanupFunctions.includes(findEnclosingFunction(assignment) ?? assignment)
    );
  });
};

const hasPotentialInterruptionAfterGuard = (
  callback: EsTreeNode,
  guardState: BooleanGuardState,
  usageNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(callback)) return true;
  const guardStart = getRangeStart(guardState.guardNode);
  const usageStart = getRangeStart(usageNode);
  if (guardStart === null || usageStart === null) return true;
  let hasPotentialInterruption = false;
  walkAst(callback.body, (child: EsTreeNode) => {
    if (hasPotentialInterruption) return false;
    if (child !== callback.body && isFunctionLike(child)) return false;
    const childStart = getRangeStart(child);
    if (childStart === null || childStart <= guardStart || childStart >= usageStart) return;
    if (
      isNodeOfType(child, "CallExpression") ||
      isNodeOfType(child, "AwaitExpression") ||
      isNodeOfType(child, "YieldExpression")
    ) {
      if (
        canNodeReachLaterNodeWithinFunction(child, usageNode, callback, context) ||
        canInterruptionReachUsageThroughCatch(child, usageNode, callback, context)
      ) {
        hasPotentialInterruption = true;
        return false;
      }
    }
  });
  return hasPotentialInterruption;
};

const getNumericReactRefCurrentKey = (
  expression: EsTreeNode,
  context: RuleContext,
): string | null => {
  const refSymbol = resolveReactRefSymbol(stripParenExpression(expression), context.scopes);
  const initializer = refSymbol?.initializer ? stripParenExpression(refSymbol.initializer) : null;
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  const initialValue = initializer.arguments?.[0]
    ? stripParenExpression(initializer.arguments[0])
    : null;
  if (!isNodeOfType(initialValue, "Literal") || typeof initialValue.value !== "number") {
    return null;
  }
  return resolveExpressionKey(expression, context);
};

const getBlockingGenerationKey = (expression: EsTreeNode, context: RuleContext): string | null => {
  const test = stripParenExpression(expression);
  if (isNodeOfType(test, "LogicalExpression") && test.operator === "||") {
    return (
      getBlockingGenerationKey(test.left, context) ?? getBlockingGenerationKey(test.right, context)
    );
  }
  if (
    !isNodeOfType(test, "BinaryExpression") ||
    (test.operator !== "!==" && test.operator !== "!=")
  ) {
    return null;
  }
  const leftKey = getNumericReactRefCurrentKey(test.left, context);
  const rightKey = getNumericReactRefCurrentKey(test.right, context);
  const snapshotExpression = leftKey
    ? stripParenExpression(test.right)
    : stripParenExpression(test.left);
  const key = leftKey ?? rightKey;
  return key && isNodeOfType(snapshotExpression, "Identifier") ? key : null;
};

const findGenerationGuardKeyForDeferredUsage = (
  usageFunction: EsTreeNode,
  usageNode: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isFunctionLike(usageFunction)) return null;
  let generationKey: string | null = null;
  walkAst(usageFunction.body, (child: EsTreeNode) => {
    if (generationKey) return false;
    if (child !== usageFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "IfStatement") || child.alternate) {
      return;
    }
    const key = getBlockingGenerationKey(child.test, context);
    if (
      !key ||
      canNodeReachLaterNodeWithinFunction(child.consequent, usageNode, usageFunction, context) ||
      !doMatchingNodesCoverEveryPathBeforeUsage(usageNode, [child], usageFunction, context)
    ) {
      return;
    }
    generationKey = key;
  });
  return generationKey;
};

const isGenerationAdvance = (
  node: EsTreeNode,
  generationKey: string,
  context: RuleContext,
): boolean => {
  if (
    isNodeOfType(node, "UpdateExpression") &&
    resolveExpressionKey(node.argument, context) === generationKey
  ) {
    return true;
  }
  if (
    !isNodeOfType(node, "AssignmentExpression") ||
    resolveExpressionKey(node.left, context) !== generationKey ||
    (node.operator !== "+=" && node.operator !== "-=")
  ) {
    return false;
  }
  const amount = stripParenExpression(node.right);
  return isNodeOfType(amount, "Literal") && typeof amount.value === "number" && amount.value !== 0;
};

const functionAdvancesGeneration = (
  owner: EsTreeNode,
  generationKey: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(owner)) return false;
  let didAdvanceGeneration = false;
  walkAst(owner.body, (child: EsTreeNode) => {
    if (didAdvanceGeneration) return false;
    if (child !== owner.body && isFunctionLike(child)) return false;
    if (isGenerationAdvance(child, generationKey, context)) {
      didAdvanceGeneration = true;
      return false;
    }
  });
  return didAdvanceGeneration;
};

const cleanupReturnsReleaseUsage = (
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  cleanupReturns.length > 0 &&
  cleanupReturns.every((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return Boolean(
      cleanupFunction &&
      isFunctionLike(cleanupFunction) &&
      doesCleanupFunctionReleaseUsage(cleanupFunction, usage, context),
    );
  });

const getOwnedFunctionReference = (
  reference: EsTreeNode,
  usageFunction: EsTreeNode,
  usageNode: EsTreeNode,
  callback: EsTreeNode,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): OwnedFunctionReference | null => {
  const directCall = findDirectCallForReference(reference);
  if (directCall) {
    const referenceOwner = findEnclosingFunction(directCall);
    if (
      referenceOwner &&
      referenceOwner !== usageFunction &&
      collectSynchronouslyEffectInvokedFunctions(callback).has(referenceOwner)
    ) {
      return { generationKey: null };
    }
    const generationKey = referenceOwner
      ? findGenerationGuardKeyForDeferredUsage(referenceOwner, directCall, context)
      : null;
    return generationKey ? { generationKey } : null;
  }
  const referenceRoot = findTransparentExpressionRoot(reference);
  const schedulerCall = referenceRoot.parent;
  if (
    !isNodeOfType(schedulerCall, "CallExpression") ||
    !schedulerCall.arguments.some((argument) => argument === referenceRoot) ||
    !isNodeOfType(schedulerCall.callee, "Identifier") ||
    schedulerCall.callee.name !== "setTimeout" ||
    !context.scopes.isGlobalReference(schedulerCall.callee)
  ) {
    return null;
  }
  const schedulerUsage: SubscribeLikeUsage = {
    kind: "timer",
    node: schedulerCall,
    resourceName: schedulerCall.callee.name,
    handleKey: findAssignedResourceKey(schedulerCall, context),
    receiverKey: null,
    registrationVerbName: schedulerCall.callee.name,
    eventKey: null,
    handlerKey: null,
  };
  const generationKey = findGenerationGuardKeyForDeferredUsage(usageFunction, usageNode, context);
  return schedulerUsage.handleKey !== null &&
    cleanupReturnsReleaseUsage(cleanupReturns, schedulerUsage, context) &&
    generationKey
    ? { generationKey }
    : null;
};

const hasGuardedRefOwnedNestedCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const usageFunction = findEnclosingFunction(usage.node);
  const usageExpression = findTransparentExpressionRoot(usage.node);
  const usageAssignment = usageExpression.parent;
  if (
    (usage.kind !== "subscribe" && usage.kind !== "timer") ||
    usage.handleKey === null ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction === callback ||
    usageFunction.async ||
    usageFunction.generator ||
    !isNodeOfType(usageAssignment, "AssignmentExpression") ||
    usageAssignment.operator !== "=" ||
    usageAssignment.right !== usageExpression ||
    !resolveReactRefSymbol(stripParenExpression(usageAssignment.left), context.scopes) ||
    !collectSynchronouslyEffectInvokedFunctions(callback).has(usageFunction) ||
    !cleanupReturnsReleaseUsage(cleanupReturns, usage, context) ||
    !doMatchingNodesCoverEveryPathFromFunctionEntry(callback, cleanupReturns, context)
  ) {
    return false;
  }
  const cleanupFunctions = cleanupReturns.flatMap((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return [];
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return cleanupFunction && isFunctionLike(cleanupFunction) ? [cleanupFunction] : [];
  });
  const bindingIdentifier = getFunctionBindingIdentifier(usageFunction);
  const functionSymbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  if (!functionSymbol || functionSymbol.references.length === 0) return false;
  const ownedReferences = functionSymbol.references.map((reference) =>
    getOwnedFunctionReference(
      reference.identifier,
      usageFunction,
      usage.node,
      callback,
      cleanupReturns,
      context,
    ),
  );
  if (ownedReferences.some((reference) => reference === null)) return false;
  const generationKeys = new Set(
    ownedReferences.flatMap((reference) =>
      reference?.generationKey ? [reference.generationKey] : [],
    ),
  );
  if (generationKeys.size !== 1) return false;
  const generationKey = generationKeys.values().next().value;
  if (typeof generationKey !== "string") return false;
  const invokedFunctions = collectSynchronouslyEffectInvokedFunctions(callback);
  return [...invokedFunctions, ...cleanupFunctions].some((owner) =>
    functionAdvancesGeneration(owner, generationKey, context),
  );
};

const hasGuardedDeferredCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  if (hasGuardedRefOwnedNestedCleanup(callback, usage, cleanupReturns, context)) {
    return true;
  }
  const usageFunction = findEnclosingFunction(usage.node);
  const promiseChainCall = usageFunction ? getPromiseChainCallForCallback(usageFunction) : null;
  if (
    usage.kind !== "timer" ||
    usage.handleKey === null ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction === callback ||
    usageFunction.async ||
    usageFunction.generator ||
    !isNodeOfType(usage.node, "CallExpression") ||
    !isNodeOfType(usage.node.callee, "Identifier") ||
    !context.scopes.isGlobalReference(usage.node.callee) ||
    !promiseChainCall ||
    !collectEffectInvokedFunctions(callback).has(usageFunction) ||
    !doMatchingNodesCoverEveryPathAfterUsage(promiseChainCall, cleanupReturns, context)
  ) {
    return false;
  }
  const usageExpression = findTransparentExpressionRoot(usage.node);
  const usageAssignment = usageExpression.parent;
  if (
    !isNodeOfType(usageAssignment, "AssignmentExpression") ||
    usageAssignment.operator !== "=" ||
    usageAssignment.right !== usageExpression ||
    !isNodeOfType(usageAssignment.left, "Identifier")
  ) {
    return false;
  }
  const handleSymbol = context.scopes.symbolFor(usageAssignment.left);
  if (
    !handleSymbol ||
    (handleSymbol.kind !== "let" && handleSymbol.kind !== "var") ||
    !isNodeOfType(handleSymbol.declarationNode, "VariableDeclarator") ||
    findEnclosingFunction(handleSymbol.declarationNode) !== callback
  ) {
    return false;
  }
  const cleanupFunctions = cleanupReturns.flatMap((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return [];
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return cleanupFunction && isFunctionLike(cleanupFunction) ? [cleanupFunction] : [];
  });
  if (cleanupFunctions.length !== cleanupReturns.length) return false;
  const globalReleaseProofsByCleanup = new Map<EsTreeNode, GlobalReleaseProof[]>();
  for (const cleanupFunction of cleanupFunctions) {
    if (!isFunctionLike(cleanupFunction)) return false;
    const globalReleaseProofs: GlobalReleaseProof[] = [];
    walkAst(cleanupFunction.body, (child: EsTreeNode) => {
      if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        isNodeOfType(child.callee, "Identifier") &&
        context.scopes.isGlobalReference(child.callee) &&
        doesReleaseCallMatchUsage(child, usage, context)
      ) {
        const handleGuard = findDirectHandleGuardForRelease(child, cleanupFunction, usage, context);
        globalReleaseProofs.push({
          anchor: handleGuard ?? child,
          call: child,
          handleGuard,
        });
      }
    });
    if (
      !doMatchingNodesCoverEveryPathFromFunctionEntry(
        cleanupFunction,
        globalReleaseProofs.map((releaseProof) => releaseProof.anchor),
        context,
      )
    ) {
      return false;
    }
    globalReleaseProofsByCleanup.set(cleanupFunction, globalReleaseProofs);
  }
  const handleAssignments = handleSymbol.references.filter((reference) =>
    isWithinAssignmentTarget(reference.identifier),
  );
  const hasUsageAssignment = handleAssignments.some(
    (handleAssignment) =>
      findTransparentExpressionRoot(handleAssignment.identifier).parent === usageAssignment,
  );
  const hasUnsafeHandleAssignment = handleAssignments.some((handleAssignment) => {
    const assignmentTarget = findTransparentExpressionRoot(handleAssignment.identifier);
    const assignment = assignmentTarget.parent;
    if (assignment === usageAssignment) return false;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== assignmentTarget
    ) {
      return true;
    }
    const assignedValue = stripParenExpression(assignment.right);
    const isNullishReset =
      (isNodeOfType(assignedValue, "Literal") && assignedValue.value === null) ||
      (isNodeOfType(assignedValue, "Identifier") &&
        assignedValue.name === "undefined" &&
        context.scopes.isGlobalReference(assignedValue));
    if (!isNullishReset) return true;
    const cleanupFunction = findEnclosingFunction(assignment);
    const globalReleaseProofs = cleanupFunction
      ? globalReleaseProofsByCleanup.get(cleanupFunction)
      : undefined;
    return !(
      cleanupFunction &&
      globalReleaseProofs &&
      doMatchingNodesCoverEveryPathBeforeUsage(
        assignment,
        globalReleaseProofs.map((releaseProof) =>
          releaseProof.handleGuard &&
          isAstDescendant(assignment, releaseProof.handleGuard.consequent)
            ? releaseProof.call
            : releaseProof.anchor,
        ),
        cleanupFunction,
        context,
      )
    );
  });
  if (!hasUsageAssignment || hasUnsafeHandleAssignment) {
    return false;
  }
  let usageAncestor: EsTreeNode | null | undefined = usage.node.parent;
  while (usageAncestor && usageAncestor !== usageFunction) {
    if (
      isNodeOfType(usageAncestor, "ForStatement") ||
      isNodeOfType(usageAncestor, "ForInStatement") ||
      isNodeOfType(usageAncestor, "ForOfStatement") ||
      isNodeOfType(usageAncestor, "WhileStatement") ||
      isNodeOfType(usageAncestor, "DoWhileStatement")
    ) {
      return false;
    }
    usageAncestor = usageAncestor.parent;
  }
  let hasPotentialInterruption = false;
  for (const argument of usage.node.arguments ?? []) {
    walkAst(argument, (argumentChild: EsTreeNode) => {
      if (hasPotentialInterruption) return false;
      if (isFunctionLike(argumentChild)) return false;
      if (
        isNodeOfType(argumentChild, "CallExpression") ||
        isNodeOfType(argumentChild, "AwaitExpression") ||
        isNodeOfType(argumentChild, "YieldExpression")
      ) {
        hasPotentialInterruption = true;
        return false;
      }
    });
  }
  if (hasPotentialInterruption) return false;
  return collectDeferredUsageGuardStates(usageFunction, usage.node, context).some(
    (guardState) =>
      isEffectLocalLifecycleGuard(callback, guardState, cleanupFunctions, context) &&
      !hasPotentialInterruptionAfterGuard(usageFunction, guardState, usage.node, context) &&
      !deferredUsageWritesGuardBeforeUsage(usageFunction, usage.node, guardState, context) &&
      cleanupReturns.every((cleanupReturn) =>
        cleanupReturnInvalidatesGuard(cleanupReturn, guardState, context),
      ),
  );
};

const effectHasCleanupForUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  if (callback.async) return false;
  if (
    usage.kind === "subscribe" &&
    findEnclosingFunction(usage.node) === callback &&
    doesResourceResultEscape(usage.node, true, true, context) &&
    isCleanupReturningSubscribeLikeCallExpression(usage.node)
  ) {
    return true;
  }
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return (
      callback.body === usage.node && isCleanupReturningSubscribeLikeCallExpression(callback.body)
    );
  }
  const matchingCleanupReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "ReturnStatement")) return;
    const returnStart = getRangeStart(child);
    const usageStart = getRangeStart(usage.node);
    if (returnStart !== null && usageStart !== null && returnStart < usageStart) return;
    const returnedValue = child.argument ? stripParenExpression(child.argument) : null;
    if (!returnedValue) return;
    if (doesBoundCleanupReleaseUsage(returnedValue, usage, context)) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (
      usage.kind === "subscribe" &&
      (returnedValue === usage.node ||
        (getRangeStart(returnedValue) !== null &&
          getRangeStart(returnedValue) === getRangeStart(usage.node))) &&
      isCleanupReturningSubscribeLikeCallExpression(returnedValue)
    ) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (
      usage.kind === "subscribe" &&
      isNodeOfType(returnedValue, "Identifier") &&
      usage.handleKey !== null &&
      resolveExpressionKey(returnedValue, context) === usage.handleKey &&
      isCleanupReturningSubscribeLikeCallExpression(usage.node)
    ) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (isNodeOfType(returnedValue, "Identifier")) {
      if (returnedValue.name === "undefined" && context.scopes.isGlobalReference(returnedValue)) {
        return;
      }
      const returnedKey = resolveExpressionKey(returnedValue, context);
      if (usage.handleKey !== null && returnedKey === usage.handleKey) return;
      const returnedSymbol = context.scopes.symbolFor(returnedValue);
      if (!returnedSymbol?.initializer) return;
    }
    const cleanupFunction = resolveStableValue(returnedValue, context);
    if (cleanupFunction && doesBoundCleanupReleaseUsage(cleanupFunction, usage, context)) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (!cleanupFunction || !isFunctionLike(cleanupFunction)) return;
    if (doesCleanupFunctionReleaseUsage(cleanupFunction, usage, context)) {
      matchingCleanupReturns.push(child);
    }
  });
  if (hasGuardedDeferredCleanup(callback, usage, matchingCleanupReturns, context)) {
    return true;
  }
  return doMatchingNodesCoverEveryPathAfterUsage(
    resolveCleanupPathAnchor(usage.node, callback, context),
    matchingCleanupReturns,
    context,
  );
};

const findFirstUsageWithoutCleanup = (
  callback: EsTreeNode,
  usages: ReadonlyArray<SubscribeLikeUsage>,
  context: RuleContext,
): SubscribeLikeUsage | null => {
  for (const usage of usages) {
    if (
      !effectHasCleanupForUsage(callback, usage, context) &&
      !hasSplitLifecycleCleanup(callback, usage, context)
    ) {
      return usage;
    }
  }
  return null;
};

// ---- Retained-function analysis (useCallback / component-scope handlers) ----
//
// A resource created inside a function that survives past the current
// call — a `useCallback` callback or a handler declared in component
// scope — leaks exactly like one created in an effect, but no effect
// cleanup return can ever release it. The firing policy here is much
// stricter than the effect policy to stay precise:
//   - `setInterval`, sockets, subscriptions, and observers need a release
//     that targets the same retained handle or registration identity.
//   - a resource returned directly escapes to the caller and is not owned
//     by the retained handler.
// Nested functions are separate scopes: a leak inside an inner callback
// or a nested `useEffect` belongs to that function's own analysis, not
// to the retained handler that happens to enclose it.
// `setTimeout` is deliberately exempt on this path: a one-shot timer
// in a handler (debounce, toast dismiss) is idiomatic, self-clearing
// fire-and-forget.

// `addEventListener(name, handler, { once: true })` self-releases.
// An externally owned `{ signal }` delegates release to its owner, while a
// locally constructed AbortController still needs a reachable abort call.
// `once` must be literally `true`: `{ once: false }` — or a value that
// may be false — keeps the listener registered. The key may be spelled
// as an identifier or a string literal (`{ "once": true }`).
const isLocalAbortControllerExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "NewExpression") &&
    isNodeOfType(unwrappedExpression.callee, "Identifier") &&
    unwrappedExpression.callee.name === "AbortController"
  ) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return isLocalAbortControllerExpression(unwrappedExpression.object, context, visitedSymbolIds);
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (symbol.initializer) {
    return isLocalAbortControllerExpression(symbol.initializer, context, visitedSymbolIds);
  }
  const bindingProperty = symbol.bindingIdentifier.parent;
  const bindingPattern = bindingProperty?.parent;
  const variableDeclarator = bindingPattern?.parent;
  return Boolean(
    isNodeOfType(bindingProperty, "Property") &&
    isNodeOfType(bindingPattern, "ObjectPattern") &&
    isNodeOfType(variableDeclarator, "VariableDeclarator") &&
    variableDeclarator.init &&
    isLocalAbortControllerExpression(variableDeclarator.init, context, visitedSymbolIds),
  );
};

const isSelfReleasingListenerOptionProperty = (
  property: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(property, "Property")) return false;
  const keyName = isNodeOfType(property.key, "Identifier")
    ? property.key.name
    : isNodeOfType(property.key, "Literal")
      ? property.key.value
      : null;
  if (keyName === "signal") {
    return !isLocalAbortControllerExpression(property.value, context);
  }
  if (keyName !== "once") return false;
  return isNodeOfType(property.value, "Literal") && property.value.value === true;
};

const hasSelfReleasingListenerOptions = (node: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(node, "CallExpression") &&
  (node.arguments ?? []).some(
    (argument) =>
      isNodeOfType(argument, "ObjectExpression") &&
      (argument.properties ?? []).some((property) =>
        isSelfReleasingListenerOptionProperty(property, context),
      ),
  );

// A release call only counts against a leak when its verb can plausibly
// release that resource. `on` pairs with `.on(name, null)` (d3-style
// removal), which `isReleaseLikeCall` already recognizes.
const PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ["addEventListener", new Set(["removeEventListener", "abort"])],
  ["addListener", new Set(["removeListener", "off", "abort"])],
  ["on", new Set(["off", "removeListener", "on"])],
  ["subscribe", new Set(["unsubscribe", "unsub"])],
  ["sub", new Set(["unsub", "unsubscribe"])],
  ["watch", new Set(["unwatch", "close"])],
  ["listen", new Set(["unlisten", "close"])],
  [OBSERVER_REGISTRATION_METHOD_NAME, new Set(["disconnect", "unobserve"])],
]);

// Whole-lifecycle verbs that release any resource kind.
const UNIVERSAL_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set([
  "cleanup",
  "dispose",
  "destroy",
  "teardown",
]);

const SOCKET_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set(["close"]);

const getReleaseVerbName = (node: EsTreeNode): string | null => {
  const callNode = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = isNodeOfType(callNode.callee, "ChainExpression")
    ? callNode.callee.expression
    : callNode.callee;
  if (isNodeOfType(callee, "Identifier")) {
    return TIMER_CLEANUP_CALLEE_NAMES.has(callee.name) ||
      GLOBAL_RELEASE_METHOD_NAMES.has(callee.name) ||
      UNIVERSAL_RELEASE_VERB_NAMES.has(callee.name)
      ? callee.name
      : null;
  }
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    const methodName = callee.property.name;
    return GLOBAL_RELEASE_METHOD_NAMES.has(methodName) ||
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(methodName) ||
      methodName === "on"
      ? methodName
      : null;
  }
  return null;
};

const isRetainedAbortControllerRefRelease = (
  releaseReceiver: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const releaseFunction = findEnclosingFunction(releaseReceiver);
  const usageFunction = findEnclosingFunction(usage.node);
  if (
    !releaseFunction ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    !isReturnedEffectCleanupFunction(releaseFunction, context) ||
    !resolveReactRefCurrentOriginSymbol(releaseReceiver, context.scopes)
  ) {
    return false;
  }
  const controllerKey = getListenerAbortControllerKey(usage, context);
  const refCurrentKey = resolveExpressionKey(releaseReceiver, context);
  if (controllerKey === null || refCurrentKey === null) return false;

  const usageFunctionBody = usageFunction.body;
  const previousAbortCalls: EsTreeNode[] = [];
  const ownershipAssignments: EsTreeNode[] = [];
  walkAst(usageFunctionBody, (child: EsTreeNode) => {
    if (child !== usageFunctionBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      resolveExpressionKey(child.left, context) === refCurrentKey &&
      resolveExpressionKey(child.right, context) === controllerKey
    ) {
      ownershipAssignments.push(child);
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const childCallee = isNodeOfType(child.callee, "ChainExpression")
      ? child.callee.expression
      : stripParenExpression(child.callee);
    if (
      isNodeOfType(childCallee, "MemberExpression") &&
      !childCallee.computed &&
      isNodeOfType(childCallee.property, "Identifier") &&
      childCallee.property.name === "abort" &&
      resolveExpressionKey(childCallee.object, context) === refCurrentKey
    ) {
      previousAbortCalls.push(child);
    }
  });
  const safeOwnershipAssignments = ownershipAssignments.filter((assignment) =>
    doMatchingNodesCoverEveryPathBeforeUsage(
      assignment,
      previousAbortCalls,
      usageFunction,
      context,
    ),
  );
  return doMatchingNodesCoverEveryPathBeforeUsage(
    usage.node,
    safeOwnershipAssignments,
    usageFunction,
    context,
  );
};

const isJsxRefAttribute = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "JSXAttribute") &&
  isNodeOfType(node.name, "JSXIdentifier") &&
  node.name.name === "ref";

const isFunctionForwardedToReactRef = (functionNode: EsTreeNode, context: RuleContext): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const expressionContainer = referenceRoot.parent;
    return Boolean(
      isNodeOfType(expressionContainer, "JSXExpressionContainer") &&
      expressionContainer.expression === referenceRoot &&
      isJsxRefAttribute(expressionContainer.parent),
    );
  });
};

const isFunctionReturnedFromReactHook = (
  functionNode: EsTreeNode,
  context: RuleContext,
  requireRefPropertyName: boolean,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const property = referenceRoot.parent;
    const propertyName = isNodeOfType(property, "Property")
      ? getStaticPropertyKeyName(property)
      : null;
    if (
      !isNodeOfType(property, "Property") ||
      property.value !== referenceRoot ||
      !isNodeOfType(property.parent, "ObjectExpression") ||
      (requireRefPropertyName && propertyName !== "ref" && !propertyName?.endsWith("Ref"))
    ) {
      return false;
    }
    const returnedObject = findTransparentExpressionRoot(property.parent);
    const returnStatement = returnedObject.parent;
    if (
      !isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== returnedObject
    ) {
      return false;
    }
    const ownerFunction = findEnclosingFunction(returnStatement);
    return Boolean(
      ownerFunction && isReactHookName(getFunctionBindingIdentifier(ownerFunction)?.name ?? ""),
    );
  });
};

const isFunctionUsedAsReactRef = (functionNode: EsTreeNode, context: RuleContext): boolean =>
  isFunctionForwardedToReactRef(functionNode, context) ||
  isFunctionReturnedFromReactHook(functionNode, context, true);

const isReactRefListenerReplacementRelease = (
  releaseCall: EsTreeNodeOfType<"CallExpression">,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(usage.node, "CallExpression")) return false;
  const usageFunction = findEnclosingFunction(usage.node);
  if (
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction !== findEnclosingFunction(releaseCall) ||
    !isFunctionUsedAsReactRef(usageFunction, context)
  ) {
    return false;
  }
  const registrationCallee = stripParenExpression(usage.node.callee);
  const releaseCallee = stripParenExpression(releaseCall.callee);
  const releaseRefSymbol = isNodeOfType(releaseCallee, "MemberExpression")
    ? resolveReactRefCurrentOriginSymbol(releaseCallee.object, context.scopes)
    : null;
  if (
    !isNodeOfType(registrationCallee, "MemberExpression") ||
    registrationCallee.computed ||
    !isNodeOfType(registrationCallee.property, "Identifier") ||
    registrationCallee.property.name !== "addEventListener" ||
    !isNodeOfType(releaseCallee, "MemberExpression") ||
    releaseCallee.computed ||
    !isNodeOfType(releaseCallee.property, "Identifier") ||
    releaseCallee.property.name !== "removeEventListener" ||
    !releaseRefSymbol
  ) {
    return false;
  }
  const registrationReceiver = stripParenExpression(registrationCallee.object);
  const registrationReceiverKey = resolveExpressionKey(registrationReceiver, context);
  const nodeParameterKey = resolveExpressionKey(usageFunction.params?.[0], context);
  const releaseReceiverKey = resolveExpressionKey(releaseCallee.object, context);
  if (
    registrationReceiverKey === null ||
    registrationReceiverKey !== nodeParameterKey ||
    releaseReceiverKey === null ||
    usage.eventKey === null ||
    usage.eventKey !== resolveExpressionKey(releaseCall.arguments?.[0], context) ||
    usage.handlerKey === null ||
    usage.handlerKey !== resolveExpressionKey(releaseCall.arguments?.[1], context)
  ) {
    return false;
  }
  const registrationCapture = resolveEventListenerCapture(usage.node.arguments?.[2], {
    allowIndeterminateEntries: true,
  });
  const releaseCapture = resolveEventListenerCapture(releaseCall.arguments?.[2], {
    allowIndeterminateEntries: true,
  });
  if (
    registrationCapture === null ||
    releaseCapture === null ||
    registrationCapture !== releaseCapture
  ) {
    return false;
  }
  const releaseStart = getRangeStart(releaseCall);
  const matchingOwnershipAssignments: EsTreeNode[] = [];
  const usageFunctionBody = usageFunction.body;
  walkAst(usageFunctionBody, (child: EsTreeNode) => {
    if (child !== usageFunctionBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      resolveReactRefSymbol(stripParenExpression(child.left), context.scopes)?.id ===
        releaseRefSymbol.id &&
      resolveExpressionKey(child.right, context) === registrationReceiverKey &&
      releaseStart !== null &&
      (getRangeStart(child) ?? -1) > releaseStart
    ) {
      matchingOwnershipAssignments.push(child);
    }
  });
  const releaseAnchor =
    findLiveExpressionGuardForRelease(releaseCall, usageFunction, releaseReceiverKey, context) ??
    releaseCall;
  const safeOwnershipAssignments = matchingOwnershipAssignments.filter((assignment) =>
    doMatchingNodesCoverEveryPathBeforeUsage(assignment, [releaseAnchor], usageFunction, context),
  );
  return (
    doMatchingNodesCoverEveryPathFromFunctionEntry(usageFunction, [releaseAnchor], context) &&
    doMatchingNodesCoverEveryPathBeforeUsage(
      usage.node,
      safeOwnershipAssignments,
      usageFunction,
      context,
    )
  );
};

const doesReleaseCallMatchUsage = (
  node: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const callNode = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = isNodeOfType(callNode.callee, "ChainExpression")
    ? callNode.callee.expression
    : callNode.callee;

  if (usage.kind === "timer") {
    const expectedCleanupName =
      usage.registrationVerbName === "setInterval" ? "clearInterval" : "clearTimeout";
    if (
      !isNodeOfType(callee, "Identifier") ||
      !TIMER_CLEANUP_CALLEE_NAMES.has(callee.name) ||
      callee.name !== expectedCleanupName
    ) {
      return false;
    }
    if (
      usage.handleKey !== null &&
      resolveExpressionKey(callNode.arguments?.[0], context) === usage.handleKey
    ) {
      return true;
    }
    const collectionKey = findContainingCollectionKey(usage.node, context);
    return (
      collectionKey !== null &&
      collectionKey === resolveIteratorCollectionKey(callNode.arguments?.[0], context)
    );
  }

  if (
    isNodeOfType(callee, "Identifier") &&
    usage.kind === "subscribe" &&
    usage.handleKey !== null &&
    resolveExpressionKey(callee, context) === usage.handleKey &&
    isCleanupReturningSubscribeLikeCallExpression(usage.node)
  ) {
    return true;
  }

  const releaseVerbName = getReleaseVerbName(callNode);
  if (!releaseVerbName) return false;

  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  const releaseReceiverKey = resolveExpressionKey(callee.object, context);
  const releaseEventKey = resolveExpressionKey(callNode.arguments?.[0], context);
  const pairedReleaseVerbNames = usage.registrationVerbName
    ? PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB.get(usage.registrationVerbName)
    : null;
  const pushedResourceCollectionKey = findPushedResourceCollectionKey(usage, context);
  const releaseReceiverForOfStatement = findForOfStatementForIteratorExpression(
    callee.object,
    context,
  );
  const releaseReceiverCollectionKey = releaseReceiverForOfStatement
    ? resolveExpressionKey(releaseReceiverForOfStatement.right, context)
    : resolveIteratorCollectionKey(callee.object, context);
  if (
    pairedReleaseVerbNames &&
    matchesPairedReleaseVerb(releaseVerbName, pairedReleaseVerbNames) &&
    pushedResourceCollectionKey !== null &&
    pushedResourceCollectionKey === releaseReceiverCollectionKey &&
    (releaseVerbName !== "unobserve" ||
      (usage.eventKey !== null && releaseEventKey === usage.eventKey))
  ) {
    return true;
  }

  if (isReactRefListenerReplacementRelease(callNode, usage, context)) return true;

  if (usage.kind === "socket") {
    return (
      usage.handleKey !== null &&
      releaseReceiverKey === usage.handleKey &&
      (SOCKET_RELEASE_VERB_NAMES.has(releaseVerbName) ||
        UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName))
    );
  }

  if (
    usage.handleKey !== null &&
    releaseReceiverKey === usage.handleKey &&
    (releaseVerbName === "unsubscribe" ||
      releaseVerbName === "unsub" ||
      releaseVerbName === "close" ||
      releaseVerbName === "unwatch" ||
      releaseVerbName === "unlisten" ||
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(releaseVerbName))
  ) {
    return true;
  }
  if (
    releaseVerbName === "abort" &&
    releaseReceiverKey === getListenerAbortControllerKey(usage, context)
  ) {
    return true;
  }
  if (
    releaseVerbName === "abort" &&
    isRetainedAbortControllerRefRelease(callee.object, usage, context)
  ) {
    return true;
  }
  if (usage.receiverKey === null || releaseReceiverKey !== usage.receiverKey) return false;
  if (
    usage.registrationVerbName === "subscribe" &&
    (releaseVerbName === "unsubscribe" || releaseVerbName === "unsub") &&
    usage.handleKey !== null &&
    resolveExpressionKey(callNode.arguments?.[0], context) === usage.handleKey
  ) {
    return true;
  }
  const pairedVerbNames = usage.registrationVerbName
    ? PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB.get(usage.registrationVerbName)
    : null;
  if (!pairedVerbNames || !matchesPairedReleaseVerb(releaseVerbName, pairedVerbNames)) return false;

  const usageEventArgument = isNodeOfType(usage.node, "CallExpression")
    ? usage.node.arguments?.[0]
    : null;
  const releaseEventArgument = callNode.arguments?.[0];
  const hasAssignmentFormLoopIterator =
    isAssignmentFormForOfIteratorReference(usageEventArgument, context) ||
    isAssignmentFormForOfIteratorReference(releaseEventArgument, context);
  if (hasAssignmentFormLoopIterator) return false;
  if (usage.eventKey !== null && releaseEventKey !== null && usage.eventKey !== releaseEventKey) {
    if (!isNodeOfType(usage.node, "CallExpression")) return false;
    const usageForOfStatement = findForOfStatementForIteratorExpression(
      usageEventArgument,
      context,
    );
    const releaseForOfStatement = findForOfStatementForIteratorExpression(
      releaseEventArgument,
      context,
    );
    if ((usageForOfStatement === null) !== (releaseForOfStatement === null)) return false;
    const usageIteratorCollectionKey = resolveIteratorCollectionKey(
      usage.node.arguments?.[0],
      context,
    );
    const releaseIteratorCollectionKey = resolveIteratorCollectionKey(
      callNode.arguments?.[0],
      context,
    );
    if (
      usageIteratorCollectionKey === null ||
      usageIteratorCollectionKey !== releaseIteratorCollectionKey
    ) {
      return false;
    }
    if (usageForOfStatement && releaseForOfStatement) {
      const registrationHandlerSymbolId = resolveStableLoopHandlerSymbolId(
        usage.node.arguments?.[1],
        context,
      );
      const releaseHandlerSymbolId = resolveStableLoopHandlerSymbolId(
        callNode.arguments?.[1],
        context,
      );
      if (
        usage.registrationVerbName !== "addEventListener" ||
        releaseVerbName !== "removeEventListener"
      ) {
        return false;
      }
      const registrationCallee = stripParenExpression(usage.node.callee);
      if (!isNodeOfType(registrationCallee, "MemberExpression")) return false;
      if (
        !isStableLoopReceiver(registrationCallee.object, context) ||
        !isStableLoopReceiver(callee.object, context) ||
        registrationHandlerSymbolId === null ||
        registrationHandlerSymbolId !== releaseHandlerSymbolId
      ) {
        return false;
      }
      const registrationCapture = resolveEventListenerCapture(usage.node.arguments?.[2], {
        allowIndeterminateEntries: true,
      });
      const releaseCapture = resolveEventListenerCapture(callNode.arguments?.[2], {
        allowIndeterminateEntries: true,
      });
      if (
        registrationCapture === null ||
        releaseCapture === null ||
        registrationCapture !== releaseCapture
      ) {
        return false;
      }
      if (!isDirectExhaustiveForOfRelease(callNode, releaseForOfStatement)) return false;
    }
  }
  if (releaseVerbName === "on") {
    const handlerArgument = callNode.arguments?.[1];
    return isNodeOfType(handlerArgument, "Literal") && handlerArgument.value === null;
  }
  if (
    releaseVerbName === "removeEventListener" ||
    releaseVerbName === "removeListener" ||
    releaseVerbName === "off"
  ) {
    const usesUnaryListenerSignature =
      usage.registrationVerbName === "addListener" &&
      isNodeOfType(usage.node, "CallExpression") &&
      usage.node.arguments?.length === 1 &&
      callNode.arguments?.length === 1;
    const releaseHandler = usesUnaryListenerSignature
      ? callNode.arguments?.[0]
      : callNode.arguments?.[1];
    if (!releaseHandler) return releaseVerbName === "off";
    const expectedHandlerKey = usesUnaryListenerSignature ? usage.eventKey : usage.handlerKey;
    const registrationHandler = isNodeOfType(usage.node, "CallExpression")
      ? usage.node.arguments?.[usesUnaryListenerSignature ? 0 : 1]
      : null;
    return (
      (expectedHandlerKey !== null &&
        resolveExpressionKey(releaseHandler, context) === expectedHandlerKey) ||
      (registrationHandler !== null &&
        resolveStableValue(releaseHandler, context) ===
          resolveStableValue(registrationHandler, context))
    );
  }
  if (releaseVerbName === "unobserve" && usage.eventKey !== null) {
    return releaseEventKey === usage.eventKey;
  }
  return true;
};

const matchesPairedReleaseVerb = (
  releaseVerbName: string,
  pairedVerbNames: ReadonlySet<string>,
): boolean =>
  pairedVerbNames.has(releaseVerbName) || UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName);

const isReturnedEffectCleanupFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  let currentNode = functionNode;
  let parentNode = currentNode.parent;
  while (
    isNodeOfType(parentNode, "ChainExpression") ||
    isNodeOfType(parentNode, "TSAsExpression") ||
    isNodeOfType(parentNode, "TSNonNullExpression")
  ) {
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  const effectCallback =
    isNodeOfType(parentNode, "ReturnStatement") && parentNode.argument === currentNode
      ? findEnclosingFunction(parentNode)
      : isNodeOfType(parentNode, "ArrowFunctionExpression") && parentNode.body === currentNode
        ? parentNode
        : null;
  const effectCall = effectCallback?.parent;
  return Boolean(
    effectCallback &&
    isNodeOfType(effectCall, "CallExpression") &&
    isReactHookCall(effectCall, CLEANUP_EFFECT_HOOK_NAMES, context.scopes),
  );
};

const isPotentiallyReachableFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    isInlineRetainedHandlerFunction(functionNode, context) ||
    isReturnedEffectCleanupFunction(functionNode, context)
  ) {
    return true;
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some(
    (reference) => findEnclosingFunction(reference.identifier) !== functionNode,
  );
};

const findRetainedDisposerStorages = (
  disposerFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): RetainedDisposerStorage[] => {
  if (!isFunctionLike(disposerFunction) || disposerFunction.async || disposerFunction.generator) {
    return [];
  }
  const usageFunction = findEnclosingFunction(usage.node);
  if (!usageFunction || !isFunctionLike(usageFunction)) return [];
  const assignments = new Map<number, RetainedDisposerStorage>();
  const collectAssignment = (expression: EsTreeNode): void => {
    const expressionRoot = findTransparentExpressionRoot(expression);
    const assignment = expressionRoot.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.right !== expressionRoot
    ) {
      return;
    }
    const refSymbol = resolveReactRefSymbol(stripParenExpression(assignment.left), context.scopes);
    const refCurrentKey = resolveExpressionKey(assignment.left, context);
    const retainedFunction = findEnclosingFunction(assignment);
    const assignmentStart = getRangeStart(assignment);
    if (
      !refSymbol ||
      !refCurrentKey ||
      !retainedFunction ||
      retainedFunction !== usageFunction ||
      assignmentStart === null
    ) {
      return;
    }
    assignments.set(assignmentStart, {
      assignmentNode: assignment,
      refCurrentKey,
      retainedFunction,
    });
  };
  collectAssignment(disposerFunction);
  const bindingIdentifier = getFunctionBindingIdentifier(disposerFunction);
  const symbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  for (const reference of symbol?.references ?? []) {
    collectAssignment(reference.identifier);
  }
  walkAst(usageFunction.body, (child: EsTreeNode) => {
    if (child !== usageFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      resolveStableValue(child.right, context) === disposerFunction
    ) {
      collectAssignment(child.right);
    }
  });
  return [...assignments.values()];
};

const isRetainedDisposerStorageEstablished = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  doMatchingNodesCoverEveryPathBeforeUsage(
    usage.node,
    [storage.assignmentNode],
    storage.retainedFunction,
    context,
  ) || doMatchingNodesCoverEveryPathAfterUsage(usage.node, [storage.assignmentNode], context);

const hasUnsafeRetainedDisposerOverwrite = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  let hasUnsafeOverwrite = false;
  walkAst(storage.retainedFunction.body, (child: EsTreeNode) => {
    if (hasUnsafeOverwrite) return false;
    if (child !== storage.retainedFunction.body && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "AssignmentExpression") ||
      child === storage.assignmentNode ||
      resolveExpressionKey(child.left, context) !== storage.refCurrentKey ||
      !canNodeReachLaterNodeWithinFunction(usage.node, child, storage.retainedFunction, context)
    ) {
      return;
    }
    const storedValue = resolveStableValue(child.right, context);
    if (
      !storedValue ||
      !isFunctionLike(storedValue) ||
      !doesCleanupFunctionReleaseUsage(storedValue, usage, context)
    ) {
      hasUnsafeOverwrite = true;
      return false;
    }
  });
  return hasUnsafeOverwrite;
};

const hasEffectCleanupInvocation = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const componentFunction = findEnclosingFunction(storage.retainedFunction);
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  const cleanupFunctionInvokesRef = (cleanupFunction: EsTreeNode): boolean => {
    if (!isFunctionLike(cleanupFunction)) return false;
    let didFindCleanupCall = false;
    walkAst(cleanupFunction.body, (child: EsTreeNode) => {
      if (didFindCleanupCall) return false;
      if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        resolveExpressionKey(child.callee, context) === storage.refCurrentKey
      ) {
        const callRoot = findTransparentExpressionRoot(child);
        const callStatement = callRoot.parent;
        const isDirectBlockStatement =
          isNodeOfType(cleanupFunction.body, "BlockStatement") &&
          isNodeOfType(callStatement, "ExpressionStatement") &&
          callStatement.parent === cleanupFunction.body;
        const isConciseBody = cleanupFunction.body === callRoot;
        if (
          (isDirectBlockStatement || isConciseBody) &&
          !hasUnprovenReturnBeforeRefOwnedRelease(
            cleanupFunction,
            child,
            storage.refCurrentKey,
            context,
          )
        ) {
          didFindCleanupCall = true;
          return false;
        }
      }
    });
    return didFindCleanupCall;
  };
  const effectReturnsCleanup = (effectCallback: EsTreeNode): boolean => {
    if (!isFunctionLike(effectCallback)) return false;
    if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
      const cleanupFunction = resolveRefOwnedCleanupFunction(effectCallback.body, context);
      return Boolean(cleanupFunction && cleanupFunctionInvokesRef(cleanupFunction));
    }
    const matchingReturns: EsTreeNode[] = [];
    walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
      const cleanupFunction = resolveRefOwnedCleanupFunction(child.argument, context);
      if (!cleanupFunction || !cleanupFunctionInvokesRef(cleanupFunction)) return;
      matchingReturns.push(child);
    });
    return doMatchingNodesCoverEveryPathFromFunctionEntry(effectCallback, matchingReturns, context);
  };
  let didFindInvocation = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (didFindInvocation) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction ||
      !isReactApiCall(child, "useEffect", context.scopes)
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (effectCallback && effectReturnsCleanup(effectCallback)) {
      didFindInvocation = true;
      return false;
    }
  });
  return didFindInvocation;
};

const hasCallbackRefReplacementInvocation = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const isReturnedCallbackRefShape = (): boolean => {
    if (!isFunctionLike(storage.retainedFunction)) return false;
    const functionRoot = findTransparentExpressionRoot(storage.retainedFunction);
    const callbackCall = functionRoot.parent;
    if (
      !isNodeOfType(callbackCall, "CallExpression") ||
      !isReactApiCall(callbackCall, "useCallback", context.scopes)
    ) {
      return false;
    }
    const nodeParameter = storage.retainedFunction.params?.[0];
    const nodeParameterKey = resolveExpressionKey(nodeParameter, context);
    if (!nodeParameterKey || usage.receiverKey !== nodeParameterKey) return false;
    if (!isFunctionReturnedFromReactHook(storage.retainedFunction, context, false)) return false;
    const usageStart = getRangeStart(usage.node);
    if (usageStart === null) return false;
    let hasNullExit = false;
    walkAst(storage.retainedFunction.body, (child: EsTreeNode) => {
      if (hasNullExit) return false;
      if (child !== storage.retainedFunction.body && isFunctionLike(child)) return false;
      if (
        !isNodeOfType(child, "IfStatement") ||
        (getRangeStart(child) ?? usageStart) >= usageStart
      ) {
        return;
      }
      const test = stripParenExpression(child.test);
      if (
        !isNodeOfType(test, "UnaryExpression") ||
        test.operator !== "!" ||
        resolveExpressionKey(test.argument, context) !== nodeParameterKey
      ) {
        return;
      }
      const consequent = child.consequent;
      hasNullExit =
        isNodeOfType(consequent, "ReturnStatement") ||
        (isNodeOfType(consequent, "BlockStatement") &&
          consequent.body.some((statement) => isNodeOfType(statement, "ReturnStatement")));
      if (hasNullExit) return false;
    });
    return hasNullExit;
  };
  if (
    !isFunctionForwardedToReactRef(storage.retainedFunction, context) &&
    !isReturnedCallbackRefShape()
  ) {
    return false;
  }
  const cleanupCalls: EsTreeNode[] = [];
  walkAst(storage.retainedFunction.body, (child: EsTreeNode) => {
    if (child !== storage.retainedFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      resolveExpressionKey(child.callee, context) === storage.refCurrentKey
    ) {
      cleanupCalls.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathBeforeUsage(
    usage.node,
    cleanupCalls,
    storage.retainedFunction,
    context,
  );
};

const isRetainedDisposerRefRelease = (
  releaseNode: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const disposerFunction = findEnclosingFunction(releaseNode);
  if (!disposerFunction) return false;
  return findRetainedDisposerStorages(disposerFunction, usage, context).some(
    (storage) =>
      isRetainedDisposerStorageEstablished(storage, usage, context) &&
      !hasUnsafeRetainedDisposerOverwrite(storage, usage, context) &&
      (hasEffectCleanupInvocation(storage, usage, context) ||
        hasCallbackRefReplacementInvocation(storage, usage, context)),
  );
};

const isSelfReleasingListenerRelease = (
  releaseNode: EsTreeNode,
  releaseFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    usage.kind !== "subscribe" ||
    usage.registrationVerbName !== "addEventListener" ||
    usage.receiverKey === null ||
    usage.eventKey === null ||
    !isNodeOfType(usage.node, "CallExpression") ||
    !isFunctionLike(releaseFunction) ||
    releaseFunction.async ||
    releaseFunction.generator ||
    !isNodeOfType(releaseFunction.body, "BlockStatement") ||
    !doMatchingNodesCoverEveryPathFromFunctionEntry(releaseFunction, [releaseNode], context)
  ) {
    return false;
  }
  const registrationCapture = resolveEventListenerCapture(usage.node.arguments?.[2], {
    allowIndeterminateEntries: true,
  });
  const releaseCall = isNodeOfType(releaseNode, "ChainExpression")
    ? releaseNode.expression
    : releaseNode;
  if (!isNodeOfType(releaseCall, "CallExpression")) return false;
  const releaseCapture = resolveEventListenerCapture(releaseCall.arguments?.[2], {
    allowIndeterminateEntries: true,
  });
  if (
    registrationCapture === null ||
    releaseCapture === null ||
    registrationCapture !== releaseCapture
  ) {
    return false;
  }
  const ownerFunction = findEnclosingFunction(releaseFunction);
  if (!ownerFunction || !isFunctionLike(ownerFunction)) return false;
  const triggerRegistrations: EsTreeNode[] = [];
  walkAst(ownerFunction.body, (child: EsTreeNode) => {
    if (child !== ownerFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const registrationDetails = getCallRegistrationDetails(child, context);
    if (
      registrationDetails.registrationVerbName === "addEventListener" &&
      registrationDetails.receiverKey === usage.receiverKey &&
      resolveStableValue(child.arguments?.[1], context) === releaseFunction
    ) {
      triggerRegistrations.push(child);
    }
  });
  if (triggerRegistrations.some((triggerRegistration) => triggerRegistration === usage.node)) {
    return true;
  }
  return (
    doMatchingNodesCoverEveryPathAfterUsage(usage.node, triggerRegistrations, context) ||
    doMatchingNodesCoverEveryPathBeforeUsage(
      usage.node,
      triggerRegistrations,
      ownerFunction,
      context,
    )
  );
};

const isReleaseReachableForUsage = (
  releaseNode: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (!isNodeReachableWithinFunction(releaseNode, context)) return false;
  const releaseFunction = findEnclosingFunction(releaseNode);
  if (!releaseFunction) return true;
  if (releaseFunction === findEnclosingFunction(usage.node)) return true;
  if (isRetainedDisposerRefRelease(releaseNode, usage, context)) return true;
  const usageFunction = findEnclosingFunction(usage.node);
  if (
    usageFunction &&
    isFunctionLike(usageFunction) &&
    getAssignedReactRefSymbol(usageFunction, context) &&
    isCleanupFunctionReferencedByReturn(usageFunction, releaseFunction, context)
  ) {
    return isReactRefCallbackCleanupOwnedByEffect(usageFunction, releaseFunction, usage, context);
  }
  if (isSelfReleasingListenerRelease(releaseNode, releaseFunction, usage, context)) return true;
  return isPotentiallyReachableFunction(releaseFunction, context);
};

const fileContainsReleaseForUsage = (usage: SubscribeLikeUsage, context: RuleContext): boolean => {
  const anyNode = usage.node;
  let programNode: EsTreeNode = anyNode;
  while (programNode.parent) programNode = programNode.parent;
  let didFindRelease = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didFindRelease) return false;
    if (
      doesReleaseCallMatchUsage(child, usage, context) &&
      isReleaseReachableForUsage(child, usage, context)
    ) {
      didFindRelease = true;
      return false;
    }
  });
  return didFindRelease;
};

const resolveRefOwnedCleanupFunction = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const resolvedExpression = resolveStableValue(expression, context);
  if (isFunctionLike(resolvedExpression)) return resolvedExpression;
  if (
    !isNodeOfType(resolvedExpression, "CallExpression") ||
    !isReactApiCall(resolvedExpression, "useCallback", context.scopes)
  ) {
    return null;
  }
  return getEffectCallback(resolvedExpression);
};

const findRefOwnedHandlerStorage = (
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): RefOwnedHandlerStorage | null => {
  if (
    !isFunctionLike(retainedFunction) ||
    usage.kind !== "subscribe" ||
    usage.registrationVerbName !== "addEventListener" ||
    usage.handlerKey === null ||
    !usage.receiverKey?.startsWith("global:") ||
    !usage.eventKey?.startsWith("literal:")
  ) {
    return null;
  }
  const usageStart = getRangeStart(usage.node);
  const functionCfg = context.cfg.cfgFor(retainedFunction);
  const usageBlock = functionCfg?.blockOf(usage.node);
  if (usageStart === null || !functionCfg || !usageBlock) return null;
  const matchingStorage: RefOwnedHandlerStorage[] = [];
  walkAst(retainedFunction.body, (child: EsTreeNode) => {
    if (child !== retainedFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AssignmentExpression") || child.operator !== "=") return;
    const assignmentStart = getRangeStart(child);
    const refCurrentExpression = stripParenExpression(child.left);
    if (
      assignmentStart === null ||
      assignmentStart >= usageStart ||
      functionCfg.blockOf(child) !== usageBlock ||
      !isNodeOfType(refCurrentExpression, "MemberExpression") ||
      !resolveReactRefSymbol(refCurrentExpression, context.scopes)
    ) {
      return;
    }
    const refCurrentKey = resolveExpressionKey(refCurrentExpression, context);
    const refKey = resolveExpressionKey(refCurrentExpression.object, context);
    const storedSession = stripParenExpression(child.right);
    if (!refCurrentKey || !refKey || !isNodeOfType(storedSession, "ObjectExpression")) return;
    const storedSessionProperties = storedSession.properties ?? [];
    if (storedSessionProperties.some((property) => !isNodeOfType(property, "Property"))) return;
    for (const property of storedSessionProperties) {
      if (!isNodeOfType(property, "Property")) continue;
      const propertyName = getStaticPropertyKeyName(property);
      if (propertyName && resolveExpressionKey(property.value, context) === usage.handlerKey) {
        const handlerKey = `${refCurrentKey}.${propertyName}`;
        matchingStorage.push({
          handlerKey,
          refCurrentKey,
          refKey,
          assignmentNode: child,
        });
      }
    }
  });
  return matchingStorage.length === 1 ? matchingStorage[0] : null;
};

const doMatchingNodesCoverEveryPathBeforeUsage = (
  usageNode: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const functionCfg = context.cfg.cfgFor(owner);
  const usageBlock = functionCfg?.blockOf(usageNode);
  const usageStart = getRangeStart(usageNode);
  if (!functionCfg || !usageBlock || usageStart === null) return false;
  const matchingBlocks = new Set(
    matchingNodes.flatMap((matchingNode) => {
      if (context.cfg.enclosingFunction(matchingNode) !== owner) return [];
      const matchingStart = getRangeStart(matchingNode);
      if (matchingStart === null || matchingStart >= usageStart) return [];
      const matchingBlock = functionCfg.blockOf(matchingNode);
      return matchingBlock ? [matchingBlock] : [];
    }),
  );
  if (matchingBlocks.size === 0) return false;
  if (matchingBlocks.has(usageBlock)) return true;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (matchingBlocks.has(currentBlock)) continue;
    if (currentBlock === usageBlock) return false;
    for (const edge of currentBlock.successors) {
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return true;
};

const retainedFunctionReleasesPreviousRefOwnedUsage = (
  retainedFunction: EsTreeNode,
  cleanupFunction: EsTreeNode,
  storageNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(retainedFunction)) return false;
  const retainedFunctionBody = retainedFunction.body;
  const cleanupCalls: EsTreeNode[] = [];
  walkAst(retainedFunctionBody, (child: EsTreeNode) => {
    if (child !== retainedFunctionBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      resolveRefOwnedCleanupFunction(child.callee, context) === cleanupFunction
    ) {
      cleanupCalls.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathBeforeUsage(
    storageNode,
    cleanupCalls,
    retainedFunction,
    context,
  );
};

const isDirectRefOwnedRelease = (
  releaseNode: EsTreeNode,
  cleanupFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  storedHandlerKey: string,
  refCurrentKey: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(cleanupFunction)) return false;
  const releaseCall = isNodeOfType(releaseNode, "ChainExpression")
    ? releaseNode.expression
    : releaseNode;
  if (
    !isNodeOfType(releaseCall, "CallExpression") ||
    !isNodeOfType(releaseCall.callee, "MemberExpression") ||
    releaseCall.callee.computed ||
    !isNodeOfType(releaseCall.callee.property, "Identifier") ||
    releaseCall.callee.property.name !== "removeEventListener" ||
    !isNodeOfType(usage.node, "CallExpression") ||
    usage.node.arguments?.[2] !== undefined ||
    releaseCall.arguments?.[2] !== undefined
  ) {
    return false;
  }
  const releaseRoot = findTransparentExpressionRoot(releaseNode);
  const releaseStatement = releaseRoot.parent;
  const releaseBlock = releaseStatement?.parent;
  const releaseGuard = releaseBlock?.parent;
  const isDirectCleanupStatement = releaseBlock === cleanupFunction.body;
  const isRefPresenceGuardedStatement = Boolean(
    isNodeOfType(releaseBlock, "BlockStatement") &&
    isNodeOfType(releaseGuard, "IfStatement") &&
    releaseGuard.consequent === releaseBlock &&
    releaseGuard.alternate === null &&
    resolveExpressionKey(releaseGuard.test, context) === refCurrentKey,
  );
  if (
    !isNodeOfType(releaseStatement, "ExpressionStatement") ||
    !isNodeOfType(cleanupFunction.body, "BlockStatement") ||
    (!isDirectCleanupStatement && !isRefPresenceGuardedStatement)
  ) {
    return false;
  }
  return (
    usage.receiverKey !== null &&
    usage.receiverKey === resolveExpressionKey(releaseCall.callee.object, context) &&
    usage.eventKey !== null &&
    usage.eventKey === resolveExpressionKey(releaseCall.arguments?.[0], context) &&
    resolveExpressionKey(releaseCall.arguments?.[1], context) === storedHandlerKey
  );
};

const isRefPresenceGuardedEarlyReturn = (
  returnStatement: EsTreeNode,
  refCurrentKey: string,
  context: RuleContext,
): boolean => {
  const returnBranch = returnStatement.parent;
  const guardStatement = isNodeOfType(returnBranch, "BlockStatement")
    ? returnBranch.parent
    : returnBranch;
  const guardedConsequent = isNodeOfType(returnBranch, "BlockStatement")
    ? returnBranch
    : returnStatement;
  if (
    !isNodeOfType(guardStatement, "IfStatement") ||
    guardStatement.consequent !== guardedConsequent ||
    guardStatement.alternate !== null
  ) {
    return false;
  }
  const guardTest = stripParenExpression(guardStatement.test);
  return (
    isNodeOfType(guardTest, "UnaryExpression") &&
    guardTest.operator === "!" &&
    resolveExpressionKey(guardTest.argument, context) === refCurrentKey
  );
};

const hasUnprovenReturnBeforeRefOwnedRelease = (
  cleanupFunction: EsTreeNode,
  releaseNode: EsTreeNode,
  refCurrentKey: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(cleanupFunction)) return true;
  const releaseStart = getRangeStart(releaseNode);
  if (releaseStart === null) return true;
  let hasUnprovenEarlyReturn = false;
  walkAst(cleanupFunction.body, (child: EsTreeNode) => {
    if (hasUnprovenEarlyReturn) return false;
    if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    const returnStart = getRangeStart(child);
    if (
      (returnStart === null || returnStart < releaseStart) &&
      !isRefPresenceGuardedEarlyReturn(child, refCurrentKey, context)
    ) {
      hasUnprovenEarlyReturn = true;
      return false;
    }
  });
  return hasUnprovenEarlyReturn;
};

const cleanupFunctionReleasesRefOwnedUsage = (
  cleanupFunction: EsTreeNode,
  componentFunction: EsTreeNode,
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isFunctionLike(cleanupFunction) ||
    !isFunctionLike(componentFunction) ||
    cleanupFunction.async ||
    cleanupFunction.generator
  ) {
    return false;
  }
  const storage = findRefOwnedHandlerStorage(retainedFunction, usage, context);
  if (!storage) return false;
  if (
    !retainedFunctionReleasesPreviousRefOwnedUsage(
      retainedFunction,
      cleanupFunction,
      storage.assignmentNode,
      context,
    )
  ) {
    return false;
  }
  let releaseNode: EsTreeNode | null = null;
  walkAst(cleanupFunction.body, (child: EsTreeNode) => {
    if (releaseNode) return false;
    if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
    if (
      isDirectRefOwnedRelease(
        child,
        cleanupFunction,
        usage,
        storage.handlerKey,
        storage.refCurrentKey,
        context,
      )
    ) {
      releaseNode = child;
      return false;
    }
  });
  if (!releaseNode) return false;
  if (
    hasUnprovenReturnBeforeRefOwnedRelease(
      cleanupFunction,
      releaseNode,
      storage.refCurrentKey,
      context,
    )
  ) {
    return false;
  }
  let hasUnsafeRefWrite = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (hasUnsafeRefWrite) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "delete") {
      const deleteTarget = stripParenExpression(child.argument);
      if (
        resolveExpressionKey(deleteTarget, context) === storage.handlerKey ||
        (isNodeOfType(deleteTarget, "MemberExpression") &&
          resolveExpressionKey(deleteTarget.object, context) === storage.refCurrentKey)
      ) {
        hasUnsafeRefWrite = true;
        return false;
      }
      return;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const doesCallReceiveOwnedRef = (child.arguments ?? []).some((argumentNode) => {
        const argumentKey = resolveExpressionKey(argumentNode, context);
        return (
          argumentKey !== null &&
          (argumentKey === storage.refKey || argumentKey === storage.refCurrentKey)
        );
      });
      if (doesCallReceiveOwnedRef) {
        hasUnsafeRefWrite = true;
        return false;
      }
      return;
    }
    if (!isNodeOfType(child, "AssignmentExpression")) return;
    const assignmentTarget = stripParenExpression(child.left);
    if (
      isNodeOfType(assignmentTarget, "MemberExpression") &&
      assignmentTarget.computed &&
      resolveExpressionKey(assignmentTarget.object, context) === storage.refCurrentKey
    ) {
      hasUnsafeRefWrite = true;
      return false;
    }
    const assignedKey = resolveExpressionKey(child.left, context);
    if (assignedKey === storage.handlerKey) {
      hasUnsafeRefWrite = true;
      return false;
    }
    if (assignedKey !== storage.refCurrentKey) return;
    const assignedValue = stripParenExpression(child.right);
    if (
      isNodeOfType(assignedValue, "Literal") &&
      assignedValue.value === null &&
      findEnclosingFunction(child) === cleanupFunction
    ) {
      return;
    }
    const assignedSession = isNodeOfType(assignedValue, "ObjectExpression") ? assignedValue : null;
    const assignedSessionProperties = assignedSession?.properties ?? [];
    const storesMatchingHandler =
      assignedSessionProperties.every((property) => isNodeOfType(property, "Property")) &&
      assignedSessionProperties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          `${storage.refCurrentKey}.${getStaticPropertyKeyName(property) ?? ""}` ===
            storage.handlerKey &&
          resolveExpressionKey(property.value, context) === usage.handlerKey,
      );
    if (findEnclosingFunction(child) !== retainedFunction || !storesMatchingHandler) {
      hasUnsafeRefWrite = true;
      return false;
    }
  });
  return !hasUnsafeRefWrite;
};

const effectReturnsRefOwnedCleanup = (
  effectCallback: EsTreeNode,
  componentFunction: EsTreeNode,
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const matchesReturnedCleanup = (returnedValue: EsTreeNode): boolean => {
    const cleanupFunction = resolveRefOwnedCleanupFunction(returnedValue, context);
    return Boolean(
      cleanupFunction &&
      cleanupFunctionReleasesRefOwnedUsage(
        cleanupFunction,
        componentFunction,
        retainedFunction,
        usage,
        context,
      ),
    );
  };
  if (!isFunctionLike(effectCallback)) return false;
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return matchesReturnedCleanup(stripParenExpression(effectCallback.body));
  }
  const matchingReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      matchesReturnedCleanup(stripParenExpression(child.argument))
    ) {
      matchingReturns.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathFromFunctionEntry(effectCallback, matchingReturns, context);
};

const hasGuaranteedRefOwnedUnmountCleanup = (
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const componentFunction = findEnclosingFunction(retainedFunction);
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  let didFindCleanupEffect = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (didFindCleanupEffect) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction ||
      !isReactApiCall(child, "useEffect", context.scopes)
    ) {
      return;
    }
    const effectStatement = findTransparentExpressionRoot(child).parent;
    if (
      !isNodeOfType(effectStatement, "ExpressionStatement") ||
      effectStatement.parent !== componentFunction.body
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (
      effectCallback &&
      effectReturnsRefOwnedCleanup(
        effectCallback,
        componentFunction,
        retainedFunction,
        usage,
        context,
      )
    ) {
      didFindCleanupEffect = true;
      return false;
    }
  });
  return didFindCleanupEffect;
};

const isUseSyncExternalStoreSubscribeFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const visitedSymbolIds = new Set<number>();
  const isSubscribeBinding = (candidateBinding: EsTreeNode): boolean => {
    const symbol = context.scopes.symbolFor(candidateBinding);
    if (!symbol || visitedSymbolIds.has(symbol.id) || symbol.references.length === 0) return false;
    visitedSymbolIds.add(symbol.id);
    return symbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const referenceParent = referenceRoot.parent;
      if (
        isNodeOfType(referenceParent, "CallExpression") &&
        referenceParent.arguments?.[0] === referenceRoot
      ) {
        return isReactApiCall(referenceParent, "useSyncExternalStore", context.scopes);
      }
      const aliasDeclaration = referenceParent?.parent;
      return Boolean(
        isNodeOfType(referenceParent, "VariableDeclarator") &&
        referenceParent.init === referenceRoot &&
        isNodeOfType(referenceParent.id, "Identifier") &&
        isNodeOfType(aliasDeclaration, "VariableDeclaration") &&
        aliasDeclaration.kind === "const" &&
        isSubscribeBinding(referenceParent.id),
      );
    });
  };
  return isSubscribeBinding(bindingIdentifier);
};

const findUnconditionalReturnStatement = (
  expression: EsTreeNode,
  ownerFunction: EsTreeNode,
): EsTreeNode | null => {
  let expressionRoot = findTransparentExpressionRoot(expression);
  while (
    isNodeOfType(expressionRoot.parent, "SequenceExpression") &&
    expressionRoot.parent.expressions.at(-1) === expressionRoot
  ) {
    expressionRoot = findTransparentExpressionRoot(expressionRoot.parent);
  }
  const returnStatement = expressionRoot.parent;
  return isNodeOfType(returnStatement, "ReturnStatement") &&
    returnStatement.argument === expressionRoot &&
    findEnclosingFunction(returnStatement) === ownerFunction
    ? returnStatement
    : null;
};

const getFinalSequenceExpressionValue = (expression: EsTreeNode): EsTreeNode => {
  let finalExpression = stripParenExpression(expression);
  while (isNodeOfType(finalExpression, "SequenceExpression")) {
    const sequenceResult = finalExpression.expressions.at(-1);
    if (!sequenceResult) break;
    finalExpression = stripParenExpression(sequenceResult);
  }
  return finalExpression;
};

const doesResourceResultEscape = (
  resourceNode: EsTreeNode,
  allowReturnedResourceEscape: boolean,
  allowConciseReturnEscape: boolean,
  context: RuleContext,
): boolean => {
  if (!allowReturnedResourceEscape) return false;
  let currentNode = resourceNode;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "ReturnStatement") && parentNode.argument === currentNode) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "ArrowFunctionExpression") &&
      parentNode.body === currentNode &&
      allowConciseReturnEscape
    ) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "ChainExpression") ||
      isNodeOfType(parentNode, "TSAsExpression") ||
      isNodeOfType(parentNode, "TSNonNullExpression")
    ) {
      currentNode = parentNode;
      parentNode = currentNode.parent;
      continue;
    }
    if (
      (isNodeOfType(parentNode, "ConditionalExpression") &&
        (parentNode.consequent === currentNode || parentNode.alternate === currentNode)) ||
      (isNodeOfType(parentNode, "LogicalExpression") &&
        (parentNode.right === currentNode ||
          (parentNode.left === currentNode && parentNode.operator !== "&&")))
    ) {
      currentNode = parentNode;
      parentNode = currentNode.parent;
      continue;
    }
    if (
      isNodeOfType(parentNode, "VariableDeclarator") &&
      parentNode.init === currentNode &&
      isNodeOfType(parentNode.id, "Identifier") &&
      isNodeOfType(parentNode.parent, "VariableDeclaration") &&
      parentNode.parent.kind === "const"
    ) {
      const ownerFunction = findEnclosingFunction(resourceNode);
      const resourceSymbol = context.scopes.symbolFor(parentNode.id);
      if (!ownerFunction || !resourceSymbol) return false;
      const matchingReturnStatements = resourceSymbol.references.flatMap((reference) => {
        if (reference.flag !== "read") return [];
        const returnStatement = findUnconditionalReturnStatement(
          reference.identifier,
          ownerFunction,
        );
        return returnStatement ? [returnStatement] : [];
      });
      return doMatchingNodesCoverEveryPathAfterUsage(
        resourceNode,
        matchingReturnStatements,
        context,
      );
    }
    return false;
  }
  return false;
};

const findRetainedFunctionLeak = (
  retainedFunction: EsTreeNode,
  context: RuleContext,
  options?: RetainedFunctionLeakOptions,
): SubscribeLikeUsage | null => {
  if (!isFunctionLike(retainedFunction)) return null;
  const body = retainedFunction.body;
  if (!body) return null;

  // A registration returned directly from the function escapes to the
  // caller, which owns the handle.
  let leak: SubscribeLikeUsage | null = null;
  const allowReturnedResourceEscape =
    options?.allowReturnedResourceEscape !== false &&
    !retainedFunction.async &&
    !isInlineRetainedHandlerFunction(retainedFunction, context);
  const allowReturnedSocketEscape =
    allowReturnedResourceEscape && options?.requireCallableReturnedResource !== true;
  const isExternalStoreSubscribeFunction = isUseSyncExternalStoreSubscribeFunction(
    retainedFunction,
    context,
  );
  const hasReleaseForUsage = (usage: SubscribeLikeUsage): boolean =>
    isExternalStoreSubscribeFunction
      ? effectHasCleanupForUsage(retainedFunction, usage, context)
      : fileContainsReleaseForUsage(usage, context) ||
        hasGuaranteedRefOwnedUnmountCleanup(retainedFunction, usage, context);
  walkAst(body, (child: EsTreeNode) => {
    if (leak !== null) return false;
    if (isFunctionLike(child)) return false;

    if (
      isSocketConstruction(child) &&
      !doesResourceResultEscape(child, allowReturnedSocketEscape, false, context)
    ) {
      const socketUsage: SubscribeLikeUsage = {
        kind: "socket",
        node: child,
        resourceName: isNodeOfType(child.callee, "Identifier") ? child.callee.name : "WebSocket",
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: null,
        eventKey: null,
        handlerKey: null,
      };
      if (!hasReleaseForUsage(socketUsage)) {
        leak = socketUsage;
        return false;
      }
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      (child.callee.name === "setInterval" ||
        (options?.includeOneShotTimers === true &&
          child.callee.name === "setTimeout" &&
          context.scopes.isGlobalReference(child.callee))) &&
      (options?.allowReturnedTimerEscape === false ||
        !doesResourceResultEscape(child, true, allowReturnedResourceEscape, context))
    ) {
      const timerUsage: SubscribeLikeUsage = {
        kind: "timer",
        node: child,
        resourceName: child.callee.name,
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: child.callee.name,
        eventKey: null,
        handlerKey: null,
      };
      if (!hasReleaseForUsage(timerUsage)) {
        leak = timerUsage;
        return false;
      }
    }

    if (
      isSubscribeOrObserveCallExpression(child) &&
      (!doesResourceResultEscape(
        child,
        allowReturnedResourceEscape,
        allowReturnedResourceEscape,
        context,
      ) ||
        (options?.requireCallableReturnedResource === true &&
          !isCleanupReturningSubscribeLikeCallExpression(child)))
    ) {
      const registrationDetails = getCallRegistrationDetails(child, context);
      const registrationVerbName = registrationDetails.registrationVerbName ?? "subscribe";
      const subscriptionUsage: SubscribeLikeUsage = {
        kind: "subscribe",
        node: child,
        resourceName: registrationVerbName,
        handleKey: findAssignedResourceKey(child, context),
        ...registrationDetails,
      };
      if (
        !hasSelfReleasingListenerOptions(child, context) &&
        !hasReleaseForUsage(subscriptionUsage)
      ) {
        leak = subscriptionUsage;
      }
      return false;
    }
  });
  return leak;
};

const getAssignedReactRefCallbackDefinition = (
  functionNode: EsTreeNode,
  context: RuleContext,
): ReactRefCallbackDefinition | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (functionNode.generator) return null;
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const assignment = functionRoot.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== functionRoot
  ) {
    return null;
  }
  const refSymbol = resolveReactRefSymbol(stripParenExpression(assignment.left), context.scopes);
  if (!refSymbol) return null;
  const componentFunction = findRenderPhaseComponentOrHook(assignment, context.scopes);
  if (
    !isFunctionLike(componentFunction) ||
    findEnclosingFunction(assignment) !== componentFunction ||
    findEnclosingFunction(refSymbol.bindingIdentifier) !== componentFunction ||
    !isNodeReachableWithinFunction(assignment, context)
  ) {
    return null;
  }
  return { assignmentNode: assignment, functionNode, refSymbol };
};

const getAssignedReactRefSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null =>
  getAssignedReactRefCallbackDefinition(functionNode, context)?.refSymbol ?? null;

const isExpressionReturnedFromFunction = (
  expression: EsTreeNode,
  ownerFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let expressionRoot = findTransparentExpressionRoot(expression);
  const bindingDeclarator = expressionRoot.parent;
  if (
    isNodeOfType(bindingDeclarator, "VariableDeclarator") &&
    bindingDeclarator.init === expressionRoot &&
    isNodeOfType(bindingDeclarator.id, "Identifier") &&
    isNodeOfType(bindingDeclarator.parent, "VariableDeclaration") &&
    bindingDeclarator.parent.kind === "const"
  ) {
    const resultSymbol = context.scopes.symbolFor(bindingDeclarator.id);
    if (!resultSymbol) return false;
    const matchingReturnStatements = resultSymbol.references.flatMap((reference) => {
      if (reference.flag !== "read") return [];
      const returnStatement = findUnconditionalReturnStatement(reference.identifier, ownerFunction);
      return returnStatement ? [returnStatement] : [];
    });
    return doMatchingNodesCoverEveryPathAfterUsage(expression, matchingReturnStatements, context);
  }
  while (true) {
    const container = expressionRoot.parent;
    if (
      isNodeOfType(container, "ConditionalExpression") &&
      (container.consequent === expressionRoot || container.alternate === expressionRoot)
    ) {
      expressionRoot = findTransparentExpressionRoot(container);
      continue;
    }
    if (
      isNodeOfType(container, "SequenceExpression") &&
      container.expressions.at(-1) === expressionRoot
    ) {
      expressionRoot = findTransparentExpressionRoot(container);
      continue;
    }
    if (isNodeOfType(container, "LogicalExpression") && container.right === expressionRoot) {
      expressionRoot = findTransparentExpressionRoot(container);
      continue;
    }
    break;
  }
  const returnStatement = expressionRoot.parent;
  return Boolean(
    (isNodeOfType(returnStatement, "ReturnStatement") &&
      returnStatement.argument === expressionRoot &&
      findEnclosingFunction(returnStatement) === ownerFunction) ||
    (isNodeOfType(ownerFunction, "ArrowFunctionExpression") &&
      ownerFunction.body === expressionRoot),
  );
};

const isReactRefCurrentCall = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  resolveReactRefSymbol(stripParenExpression(node.callee), context.scopes)?.id === refSymbol.id;

const collectAssignedReactRefCallbacks = (
  componentFunction: ReactRefCallbackDefinition["functionNode"],
  context: RuleContext,
): Map<number, ReactRefCallbackDefinition[]> => {
  const callbackDefinitionsByRefSymbolId = new Map<number, ReactRefCallbackDefinition[]>();
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (!isFunctionLike(child)) return;
    const callbackDefinition = getAssignedReactRefCallbackDefinition(child, context);
    if (callbackDefinition) {
      const existingDefinitions =
        callbackDefinitionsByRefSymbolId.get(callbackDefinition.refSymbol.id) ?? [];
      existingDefinitions.push(callbackDefinition);
      callbackDefinitionsByRefSymbolId.set(callbackDefinition.refSymbol.id, existingDefinitions);
    }
    return false;
  });
  for (const [refSymbolId, callbackDefinitions] of callbackDefinitionsByRefSymbolId) {
    const activeDefinitions = callbackDefinitions.filter(
      (callbackDefinition) =>
        !doMatchingNodesCoverEveryPathAfterUsage(
          callbackDefinition.assignmentNode,
          callbackDefinitions
            .filter((otherDefinition) => otherDefinition !== callbackDefinition)
            .map((otherDefinition) => otherDefinition.assignmentNode),
          context,
        ),
    );
    if (activeDefinitions.length === 0) {
      callbackDefinitionsByRefSymbolId.delete(refSymbolId);
    } else {
      callbackDefinitionsByRefSymbolId.set(refSymbolId, activeDefinitions);
    }
  }
  return callbackDefinitionsByRefSymbolId;
};

const collectUndominatedReactRefCalls = (
  ownerFunction: EsTreeNode,
  refSymbol: SymbolDescriptor,
  context: RuleContext,
): EsTreeNode[] => {
  if (!isFunctionLike(ownerFunction)) return [];
  const refWrites: EsTreeNode[] = [];
  const refCalls: EsTreeNode[] = [];
  walkAst(ownerFunction.body, (child: EsTreeNode) => {
    if (child !== ownerFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeReachableWithinFunction(child, context) &&
      resolveReactRefSymbol(stripParenExpression(child.left), context.scopes)?.id === refSymbol.id
    ) {
      refWrites.push(child);
    }
    if (
      isReactRefCurrentCall(child, refSymbol, context) &&
      isNodeReachableWithinFunction(child, context)
    ) {
      refCalls.push(child);
    }
  });
  return refCalls.filter(
    (refCall) =>
      !doMatchingNodesCoverEveryPathBeforeUsage(refCall, refWrites, ownerFunction, context),
  );
};

const mergeReactRefEffectUsage = (
  usageByRefSymbolId: Map<number, ReactRefEffectUsage>,
  refSymbolId: number,
  doesEffectOwnResult: boolean,
): boolean => {
  const existingUsage = usageByRefSymbolId.get(refSymbolId);
  if (!existingUsage) {
    usageByRefSymbolId.set(refSymbolId, {
      doesEffectOwnEveryResult: doesEffectOwnResult,
    });
    return true;
  }
  if (!existingUsage.doesEffectOwnEveryResult || doesEffectOwnResult) return false;
  existingUsage.doesEffectOwnEveryResult = false;
  return true;
};

const collectReactRefEffectAnalysis = (
  componentFunction: ReactRefCallbackDefinition["functionNode"],
  context: RuleContext,
): ReactRefEffectAnalysis => {
  let analysisByComponent = REACT_REF_EFFECT_ANALYSIS_CACHE.get(context);
  if (!analysisByComponent) {
    analysisByComponent = new WeakMap();
    REACT_REF_EFFECT_ANALYSIS_CACHE.set(context, analysisByComponent);
  }
  const cachedAnalysis = analysisByComponent.get(componentFunction);
  if (cachedAnalysis) return cachedAnalysis;
  const callbackDefinitionsByRefSymbolId = collectAssignedReactRefCallbacks(
    componentFunction,
    context,
  );
  const usageByRefSymbolId = new Map<number, ReactRefEffectUsage>();
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (child !== componentFunction.body && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction ||
      !isReactApiCall(child, CLEANUP_EFFECT_HOOK_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
      })
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (!isFunctionLike(effectCallback)) return;
    for (const callbackDefinitions of callbackDefinitionsByRefSymbolId.values()) {
      const refSymbol = callbackDefinitions[0]?.refSymbol;
      if (!refSymbol) continue;
      for (const refCall of collectUndominatedReactRefCalls(effectCallback, refSymbol, context)) {
        mergeReactRefEffectUsage(
          usageByRefSymbolId,
          refSymbol.id,
          !effectCallback.async &&
            isExpressionReturnedFromFunction(refCall, effectCallback, context),
        );
      }
    }
  });

  let didUsageChange = true;
  while (didUsageChange) {
    didUsageChange = false;
    for (const callbackDefinitions of callbackDefinitionsByRefSymbolId.values()) {
      const ownerRefSymbol = callbackDefinitions[0]?.refSymbol;
      if (!ownerRefSymbol) continue;
      const ownerUsage = usageByRefSymbolId.get(ownerRefSymbol.id);
      if (!ownerUsage) continue;
      for (const callbackDefinition of callbackDefinitions) {
        for (const targetDefinitions of callbackDefinitionsByRefSymbolId.values()) {
          const targetRefSymbol = targetDefinitions[0]?.refSymbol;
          if (!targetRefSymbol) continue;
          for (const refCall of collectUndominatedReactRefCalls(
            callbackDefinition.functionNode,
            targetRefSymbol,
            context,
          )) {
            const doesEffectOwnResult =
              ownerUsage.doesEffectOwnEveryResult &&
              !callbackDefinition.functionNode.async &&
              isExpressionReturnedFromFunction(refCall, callbackDefinition.functionNode, context);
            if (
              mergeReactRefEffectUsage(usageByRefSymbolId, targetRefSymbol.id, doesEffectOwnResult)
            ) {
              didUsageChange = true;
            }
          }
        }
      }
    }
  }
  const analysis = { callbackDefinitionsByRefSymbolId, usageByRefSymbolId };
  analysisByComponent.set(componentFunction, analysis);
  return analysis;
};

const getReactRefEffectUsage = (
  retainedFunction: EsTreeNode,
  context: RuleContext,
): ReactRefEffectUsage | null => {
  if (!isFunctionLike(retainedFunction)) return null;
  const callbackDefinition = getAssignedReactRefCallbackDefinition(retainedFunction, context);
  const componentFunction = findRenderPhaseComponentOrHook(retainedFunction, context.scopes);
  if (!callbackDefinition || !isFunctionLike(componentFunction)) return null;
  const analysis = collectReactRefEffectAnalysis(componentFunction, context);
  const activeDefinitions = analysis.callbackDefinitionsByRefSymbolId.get(
    callbackDefinition.refSymbol.id,
  );
  if (
    !activeDefinitions?.some(
      (activeDefinition) => activeDefinition.functionNode === retainedFunction,
    )
  ) {
    return null;
  }
  return analysis.usageByRefSymbolId.get(callbackDefinition.refSymbol.id) ?? null;
};

const isReactRefCallbackCleanupOwnedByEffect = (
  retainedFunction: EsTreeNode,
  cleanupFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isFunctionLike(retainedFunction) ||
    retainedFunction.async ||
    getReactRefEffectUsage(retainedFunction, context)?.doesEffectOwnEveryResult !== true
  ) {
    return false;
  }
  if (!isNodeOfType(retainedFunction.body, "BlockStatement")) return false;
  const doesReturnedCleanupCallFunction = (returnedValue: EsTreeNode): boolean => {
    const returnedCleanupFunction = resolveRefOwnedCleanupFunction(
      getFinalSequenceExpressionValue(returnedValue),
      context,
    );
    if (!returnedCleanupFunction) return false;
    if (returnedCleanupFunction === cleanupFunction) return true;
    if (!isFunctionLike(returnedCleanupFunction)) return false;
    const matchingCalls: EsTreeNode[] = [];
    walkAst(returnedCleanupFunction.body, (child: EsTreeNode) => {
      if (child !== returnedCleanupFunction.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        resolveRefOwnedCleanupFunction(child.callee, context) === cleanupFunction
      ) {
        matchingCalls.push(child);
      }
    });
    return doMatchingNodesCoverEveryPathFromFunctionEntry(
      returnedCleanupFunction,
      matchingCalls,
      context,
    );
  };
  const matchingReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(retainedFunction.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      doesReturnedCleanupCallFunction(child.argument)
    ) {
      matchingReturns.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathAfterUsage(usage.node, matchingReturns, context);
};

const isCleanupFunctionReferencedByReturn = (
  ownerFunction: EsTreeNode,
  cleanupFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(ownerFunction) || !isNodeOfType(ownerFunction.body, "BlockStatement")) {
    return false;
  }
  let isReferencedByReturn = false;
  walkInsideStatementBlocks(ownerFunction.body, (child: EsTreeNode) => {
    if (isReferencedByReturn || !isNodeOfType(child, "ReturnStatement") || !child.argument) {
      return;
    }
    walkAst(child.argument, (returnedChild: EsTreeNode) => {
      if (resolveRefOwnedCleanupFunction(returnedChild, context) !== cleanupFunction) return;
      isReferencedByReturn = true;
      return false;
    });
  });
  return isReferencedByReturn;
};

const isRetainedComponentScopeFunction = (functionNode: EsTreeNode): boolean => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    return enclosingComponentOrHookName(functionNode) !== null;
  }
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionExpression")
  ) {
    return false;
  }
  // Only named component-scope bindings (`const onScroll = () => {...}`);
  // inline callback arguments are attributed to whatever consumes them.
  if (!isNodeOfType(functionNode.parent, "VariableDeclarator")) return false;
  return enclosingComponentOrHookName(functionNode) !== null;
};

const isDirectJsxEventHandlerValue = (expression: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const expressionContainer = expressionRoot.parent;
  return (
    isNodeOfType(expressionContainer, "JSXExpressionContainer") &&
    expressionContainer.expression === expressionRoot &&
    isEventHandlerAttribute(expressionContainer.parent)
  );
};

const isInlineRetainedHandlerFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const callbackCall = functionRoot.parent;
  if (
    isNodeOfType(callbackCall, "CallExpression") &&
    callbackCall.arguments?.[0] === functionRoot &&
    isReactHookCall(callbackCall, "useCallback", context.scopes) &&
    isDirectJsxEventHandlerValue(callbackCall)
  ) {
    return true;
  }
  const parentNode = functionNode.parent;
  if (isDirectJsxEventHandlerValue(functionNode)) return true;
  if (
    !isNodeOfType(parentNode, "Property") ||
    parentNode.value !== functionNode ||
    parentNode.computed
  ) {
    return false;
  }
  const propertyName = getStaticPropertyKeyName(parentNode);
  if (!propertyName || !/^on[A-Z]/.test(propertyName)) return false;
  const objectExpression = parentNode.parent;
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return false;
  const objectParent = objectExpression.parent;
  const isPassedInline =
    (isNodeOfType(objectParent, "CallExpression") &&
      objectParent.arguments.some((argument) => argument === objectExpression)) ||
    isNodeOfType(objectParent, "JSXExpressionContainer");
  return isPassedInline && findRenderPhaseComponentOrHook(parentNode, context.scopes) !== null;
};

export const effectNeedsCleanup = defineRule({
  id: "effect-needs-cleanup",
  title: "Effect subscription or timer never cleaned up",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Return a cleanup function that stops the subscription or timer: `return () => target.removeEventListener(name, handler)` for listeners, `return () => clearInterval(id)` or `clearTimeout(id)` for timers, `return () => observer.disconnect()` for observers, `return () => socket.close()` for connections, or `return unsubscribe` if the subscribe call already gave you one.",
  create: (context: RuleContext) => {
    const reportRetainedLeak = (retainedFunction: EsTreeNode): void => {
      const refEffectUsage = getReactRefEffectUsage(retainedFunction, context);
      if (!refEffectUsage && !isPotentiallyReachableFunction(retainedFunction, context)) {
        return;
      }
      const leak = findRetainedFunctionLeak(
        retainedFunction,
        context,
        refEffectUsage
          ? {
              allowReturnedResourceEscape: refEffectUsage.doesEffectOwnEveryResult,
              allowReturnedTimerEscape: false,
              includeOneShotTimers: true,
              requireCallableReturnedResource: true,
            }
          : undefined,
      );
      if (!leak) return;
      const resourceNoun = RESOURCE_NOUN_BY_KIND[leak.kind];
      context.report({
        node: leak.node,
        message: `\`${leak.resourceName}\` creates a ${resourceNoun} in a function that outlives the render, with no cleanup path. Store the handle and release it, or move this into a useEffect that returns cleanup, so it does not leak after unmount.`,
      });
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isReactHookCall(node, "useCallback", context.scopes)) {
          const retainedCallback = getEffectCallback(node);
          if (retainedCallback && !isInlineRetainedHandlerFunction(retainedCallback, context)) {
            reportRetainedLeak(retainedCallback);
          }
          return;
        }
        if (!isReactHookCall(node, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        const usages = removeSynchronouslyReleasedUsages(
          callback,
          findSubscribeLikeUsages(callback, context),
          context,
        );
        if (usages.length === 0) return;

        const firstUsage = findFirstUsageWithoutCleanup(callback, usages, context);
        if (!firstUsage) return;
        const resourceNoun = RESOURCE_NOUN_BY_KIND[firstUsage.kind];
        const hookName = getCalleeName(node) ?? "effect";
        context.report({
          node,
          message: `\`${firstUsage.resourceName}\` creates a ${resourceNoun} in ${hookName} without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.`,
        });
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (isRetainedComponentScopeFunction(node)) reportRetainedLeak(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (
          isRetainedComponentScopeFunction(node) ||
          isInlineRetainedHandlerFunction(node, context) ||
          getAssignedReactRefSymbol(node, context)
        ) {
          reportRetainedLeak(node);
        }
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (
          isRetainedComponentScopeFunction(node) ||
          isInlineRetainedHandlerFunction(node, context) ||
          getAssignedReactRefSymbol(node, context)
        ) {
          reportRetainedLeak(node);
        }
      },
    };
  },
});
