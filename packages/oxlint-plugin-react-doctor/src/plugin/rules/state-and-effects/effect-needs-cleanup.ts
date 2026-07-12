import {
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../constants/dom.js";
import {
  BOUND_RESOURCE_RELEASE_METHOD_NAMES,
  EFFECT_HOOK_NAMES,
  GLOBAL_RELEASE_METHOD_NAMES,
  SUBSCRIPTION_METHOD_NAMES,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
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
import { isHookCall } from "../../utils/is-hook-call.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isCleanupReturningSubscribeLikeCallExpression,
  isSubscribeLikeCallExpression,
} from "./utils/is-subscribe-like-call-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `observer.observe(el)` is the registration moment for ResizeObserver /
// MutationObserver / IntersectionObserver et al. — subscription-shaped,
// but not in `SUBSCRIPTION_METHOD_NAMES` (other consumers of that set
// treat subscriptions as store-like).
const OBSERVER_REGISTRATION_METHOD_NAME = "observe";
const CLEANUP_EFFECT_HOOK_NAMES = new Set([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);

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

const RESOURCE_NOUN_BY_KIND = {
  subscribe: "subscription",
  timer: "timer",
  socket: "connection",
} as const;

const isSocketConstruction = (node: EsTreeNode): node is EsTreeNodeOfType<"NewExpression"> =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP.has(node.callee.name);

const isSubscribeOrObserveCall = (node: EsTreeNode): boolean => {
  if (isSubscribeLikeCallExpression(node)) return true;
  return (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === OBSERVER_REGISTRATION_METHOD_NAME
  );
};

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

    if (
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      (SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name) ||
        child.callee.property.name === OBSERVER_REGISTRATION_METHOD_NAME)
    ) {
      const registrationDetails = getCallRegistrationDetails(child, context);
      usages.push({
        kind: "subscribe",
        node: child,
        resourceName: child.callee.property.name,
        handleKey: findAssignedResourceKey(child, context),
        ...registrationDetails,
      });
    }
  });
  return usages.filter((usage) => isNodeReachableWithinFunction(usage.node, context));
};

const isNodeReachableWithinFunction = (node: EsTreeNode, context: RuleContext): boolean => {
  const owner = context.cfg.enclosingFunction(node);
  if (!owner) return true;
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return true;
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return true;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (currentBlock === targetBlock) return true;
    for (const edge of currentBlock.successors) {
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
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

const resolveIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression || !isNodeOfType(expression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(expression);
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
  if (invocationCalls.length !== 1) return null;
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
  walkAst(cleanupFunction.body, (cleanupChild: EsTreeNode) => {
    if (didCleanupFunctionMatch) return false;
    if (
      cleanupChild !== cleanupFunction.body &&
      isFunctionLike(cleanupChild) &&
      !isSynchronousIteratorCallback(cleanupChild)
    ) {
      return false;
    }
    if (doesReleaseCallMatchUsage(cleanupChild, usage, context)) {
      didCleanupFunctionMatch = true;
      return false;
    }
    const helperCall = isNodeOfType(cleanupChild, "ChainExpression")
      ? cleanupChild.expression
      : cleanupChild;
    if (!isNodeOfType(helperCall, "CallExpression")) return;
    const stableHelperFunction = resolveStableValue(helperCall.callee, context);
    const helperFunction = isNodeOfType(stableHelperFunction, "Identifier")
      ? resolveSingleAssignedCleanupFunction(stableHelperFunction, usage, context)
      : stableHelperFunction;
    if (
      helperFunction &&
      isFunctionLike(helperFunction) &&
      doesCleanupFunctionReleaseUsage(helperFunction, usage, context, visitedFunctions)
    ) {
      didCleanupFunctionMatch = true;
      return false;
    }
  });
  return didCleanupFunctionMatch;
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
  const findHandleGuard = (releaseCall: EsTreeNode): EsTreeNode | null => {
    if (usage.handleKey === null) return null;
    let ancestor = releaseCall.parent;
    while (ancestor && ancestor !== callback.body) {
      if (isNodeOfType(ancestor, "IfStatement")) {
        return ancestor.alternate === null &&
          resolveExpressionKey(ancestor.test, context) === usage.handleKey &&
          getRangeStart(ancestor) !== null &&
          (getRangeStart(ancestor) ?? usageStart) < usageStart
          ? ancestor
          : null;
      }
      ancestor = ancestor.parent;
    }
    return null;
  };
  const matchingReleaseAnchors: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const releaseStart = getRangeStart(child);
    const handleGuard = findHandleGuard(child);
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
    if (!isHookCall(child, CLEANUP_EFFECT_HOOK_NAMES)) return;
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
  if (
    usage.kind === "subscribe" &&
    findEnclosingFunction(usage.node) === callback &&
    doesResourceResultEscape(usage.node, true) &&
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
  if (usage.receiverKey === null || releaseReceiverKey !== usage.receiverKey) return false;
  const pairedVerbNames = usage.registrationVerbName
    ? PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB.get(usage.registrationVerbName)
    : null;
  if (!pairedVerbNames || !matchesPairedReleaseVerb(releaseVerbName, pairedVerbNames)) return false;

  const releaseEventKey = resolveExpressionKey(callNode.arguments?.[0], context);
  if (usage.eventKey !== null && releaseEventKey !== null && usage.eventKey !== releaseEventKey) {
    const usageIteratorCollectionKey = isNodeOfType(usage.node, "CallExpression")
      ? resolveIteratorCollectionKey(usage.node.arguments?.[0], context)
      : null;
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
    const releaseHandler = callNode.arguments?.[1];
    if (!releaseHandler) return releaseVerbName === "off";
    return (
      usage.handlerKey !== null &&
      resolveExpressionKey(releaseHandler, context) === usage.handlerKey
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

const isReturnedEffectCleanupFunction = (functionNode: EsTreeNode): boolean => {
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
  if (!isNodeOfType(parentNode, "ReturnStatement") || parentNode.argument !== currentNode) {
    return false;
  }
  const effectCallback = findEnclosingFunction(parentNode);
  const effectCall = effectCallback?.parent;
  return Boolean(
    effectCallback &&
    isNodeOfType(effectCall, "CallExpression") &&
    isHookCall(effectCall, CLEANUP_EFFECT_HOOK_NAMES),
  );
};

const isPotentiallyReachableFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    isInlineRetainedHandlerFunction(functionNode, context) ||
    isReturnedEffectCleanupFunction(functionNode)
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

const isReleaseReachableForUsage = (
  releaseNode: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (!isNodeReachableWithinFunction(releaseNode, context)) return false;
  const releaseFunction = findEnclosingFunction(releaseNode);
  if (!releaseFunction) return true;
  if (releaseFunction === findEnclosingFunction(usage.node)) return true;
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

const doesResourceResultEscape = (
  resourceNode: EsTreeNode,
  allowConciseReturnEscape: boolean,
): boolean => {
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
    return false;
  }
  return false;
};

const findRetainedFunctionLeak = (
  retainedFunction: EsTreeNode,
  context: RuleContext,
): SubscribeLikeUsage | null => {
  if (!isFunctionLike(retainedFunction)) return null;
  const body = retainedFunction.body;
  if (!body) return null;

  // A registration returned directly from the function escapes to the
  // caller, which owns the handle.
  let leak: SubscribeLikeUsage | null = null;
  const allowConciseReturnEscape = !isInlineRetainedHandlerFunction(retainedFunction, context);
  const isExternalStoreSubscribeFunction = isUseSyncExternalStoreSubscribeFunction(
    retainedFunction,
    context,
  );
  const hasReleaseForUsage = (usage: SubscribeLikeUsage): boolean =>
    isExternalStoreSubscribeFunction
      ? effectHasCleanupForUsage(retainedFunction, usage, context)
      : fileContainsReleaseForUsage(usage, context);
  walkAst(body, (child: EsTreeNode) => {
    if (leak !== null) return false;
    if (isFunctionLike(child)) return false;

    if (isSocketConstruction(child) && !doesResourceResultEscape(child, false)) {
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
      child.callee.name === "setInterval" &&
      !doesResourceResultEscape(child, allowConciseReturnEscape)
    ) {
      const timerUsage: SubscribeLikeUsage = {
        kind: "timer",
        node: child,
        resourceName: "setInterval",
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: "setInterval",
        eventKey: null,
        handlerKey: null,
      };
      if (!hasReleaseForUsage(timerUsage)) {
        leak = timerUsage;
        return false;
      }
    }

    if (
      isSubscribeOrObserveCall(child) &&
      !doesResourceResultEscape(child, allowConciseReturnEscape)
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
    isHookCall(callbackCall, "useCallback") &&
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
      if (!isPotentiallyReachableFunction(retainedFunction, context)) return;
      const leak = findRetainedFunctionLeak(retainedFunction, context);
      if (!leak) return;
      const resourceNoun = RESOURCE_NOUN_BY_KIND[leak.kind];
      context.report({
        node: leak.node,
        message: `\`${leak.resourceName}\` creates a ${resourceNoun} in a function that outlives the render, with no cleanup path. Store the handle and release it, or move this into a useEffect that returns cleanup, so it does not leak after unmount.`,
      });
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isHookCall(node, "useCallback")) {
          const retainedCallback = getEffectCallback(node);
          if (retainedCallback && !isInlineRetainedHandlerFunction(retainedCallback, context)) {
            reportRetainedLeak(retainedCallback);
          }
          return;
        }
        if (!isHookCall(node, CLEANUP_EFFECT_HOOK_NAMES)) return;
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
          message: `\`${firstUsage.resourceName}\` creates a ${resourceNoun} in ${hookName} without returning cleanup. Return a cleanup function so it does not leak after unmount.`,
        });
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (isRetainedComponentScopeFunction(node)) reportRetainedLeak(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (
          isRetainedComponentScopeFunction(node) ||
          isInlineRetainedHandlerFunction(node, context)
        ) {
          reportRetainedLeak(node);
        }
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (
          isRetainedComponentScopeFunction(node) ||
          isInlineRetainedHandlerFunction(node, context)
        ) {
          reportRetainedLeak(node);
        }
      },
    };
  },
});
