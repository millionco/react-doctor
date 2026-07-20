import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import { collectBindingAliases } from "../../utils/collect-binding-aliases.js";
import {
  collectReturnedCleanupFunctions,
  resolveCleanupFunctions,
} from "../../utils/collect-returned-cleanup-functions.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../utils/do-nodes-cover-every-path-from-function-entry.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isProvenEffectHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";

const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);
const COLLECTION_MUTATION_METHOD_NAMES = new Set([
  "clear",
  "delete",
  "pop",
  "push",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

interface TrackedObserver {
  construction: EsTreeNodeOfType<"NewExpression">;
  bindingIdentifier: EsTreeNode;
  bindingIdentifiers: Set<EsTreeNode>;
  didObserve: boolean;
  didObserveUnknownTarget: boolean;
  didReleaseAll: boolean;
  didReleaseAllViaCallbackParameter: boolean;
  callbackReleasedTargetKeys: Set<string>;
  didEscape: boolean;
  observationCalls: EsTreeNodeOfType<"CallExpression">[];
  observedIterationTargetKeys: Set<string>;
  observedTargetKeys: Set<string>;
}

interface CallbackObserverRelease {
  didReleaseAll: boolean;
  didReleaseObservedEntries: boolean;
  releasedTargetKeys: Set<string>;
}

const symbolHasCollectionMutation = (
  symbol: NonNullable<ReturnType<RuleContext["scopes"]["symbolFor"]>>,
): boolean =>
  symbol.references.some((reference) => {
    if (reference.flag !== "read") return true;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const member = referenceRoot.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
      return false;
    }
    if (isNodeOfType(member.parent, "AssignmentExpression") && member.parent.left === member) {
      return true;
    }
    return Boolean(
      isNodeOfType(member.parent, "CallExpression") &&
      member.parent.callee === member &&
      COLLECTION_MUTATION_METHOD_NAMES.has(getStaticPropertyName(member) ?? ""),
    );
  });

const resolveStableCollectionIdentifier = (
  collection: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): EsTreeNodeOfType<"Identifier"> | null => {
  let current = collection;
  const visitedSymbolIds = new Set<number>();
  while (true) {
    const symbol = context.scopes.symbolFor(current);
    if (!symbol || visitedSymbolIds.has(symbol.id) || symbolHasCollectionMutation(symbol)) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return current;
    const resolvedInitializer = stripParenExpression(initializer);
    if (!isNodeOfType(resolvedInitializer, "Identifier")) return current;
    current = resolvedInitializer;
  }
};

const isIteratorCallUnconditional = (iteratorCall: EsTreeNode): boolean => {
  const ownerFunction = findEnclosingFunction(iteratorCall);
  if (!ownerFunction) return false;
  let ancestor = iteratorCall.parent ?? null;
  while (ancestor && ancestor !== ownerFunction) {
    if (
      isNodeOfType(ancestor, "ConditionalExpression") ||
      isNodeOfType(ancestor, "IfStatement") ||
      isNodeOfType(ancestor, "LogicalExpression") ||
      isNodeOfType(ancestor, "SwitchStatement") ||
      isNodeOfType(ancestor, "ForStatement") ||
      isNodeOfType(ancestor, "ForInStatement") ||
      isNodeOfType(ancestor, "ForOfStatement") ||
      isNodeOfType(ancestor, "WhileStatement") ||
      isNodeOfType(ancestor, "DoWhileStatement")
    ) {
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return ancestor === ownerFunction;
};

const serializeForEachTarget = (
  methodCall: EsTreeNodeOfType<"CallExpression">,
  targetArgument: EsTreeNode,
  context: RuleContext,
): string | null => {
  const iteratorCallback = findEnclosingFunction(methodCall);
  if (!iteratorCallback || !isFunctionLike(iteratorCallback)) return null;
  const callbackRoot = findTransparentExpressionRoot(iteratorCallback);
  const iteratorCall = callbackRoot.parent;
  if (
    !isNodeOfType(iteratorCall, "CallExpression") ||
    !iteratorCall.arguments.some((argument) => argument === callbackRoot)
  ) {
    return null;
  }
  const iteratorCallee = stripParenExpression(iteratorCall.callee);
  if (
    !isNodeOfType(iteratorCallee, "MemberExpression") ||
    getStaticPropertyName(iteratorCallee) !== "forEach"
  ) {
    return null;
  }
  if (iteratorCallback.async || !isIteratorCallUnconditional(iteratorCall)) return null;
  const collection = stripParenExpression(iteratorCallee.object);
  if (!isNodeOfType(collection, "Identifier")) return null;
  const stableCollection = resolveStableCollectionIdentifier(collection, context);
  if (!stableCollection) return null;
  const collectionKey = serializeReferenceKey({
    node: stableCollection,
    scopes: context.scopes,
  });
  if (!collectionKey) return null;

  const visitedSymbolIds = new Set<number>();
  const serializeExpression = (rawExpression: EsTreeNode): string | null => {
    const expression = stripParenExpression(rawExpression);
    if (isNodeOfType(expression, "Identifier")) {
      const symbol = context.scopes.symbolFor(expression);
      if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
      const parameterIndex = iteratorCallback.params.findIndex(
        (parameter: EsTreeNode) =>
          context.scopes.symbolFor(parameter)?.bindingIdentifier === symbol?.bindingIdentifier,
      );
      if (parameterIndex >= 0) return `$${parameterIndex}`;
      const initializer = getDirectUnreassignedInitializer(symbol);
      if (
        initializer &&
        !visitedSymbolIds.has(symbol.id) &&
        findEnclosingFunction(symbol.declarationNode) === iteratorCallback
      ) {
        visitedSymbolIds.add(symbol.id);
        return serializeExpression(initializer);
      }
      return serializeReferenceKey({ node: expression, scopes: context.scopes });
    }
    if (isNodeOfType(expression, "Literal")) return JSON.stringify(expression.value);
    if (isNodeOfType(expression, "MemberExpression")) {
      const receiver = serializeExpression(expression.object as EsTreeNode);
      const propertyName = getStaticPropertyName(expression);
      return receiver && propertyName ? `${receiver}.${propertyName}` : null;
    }
    if (isNodeOfType(expression, "CallExpression")) {
      const callee = stripParenExpression(expression.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        getStaticPropertyName(callee) !== "getElementById"
      ) {
        return null;
      }
      const receiver = stripParenExpression(callee.object);
      if (
        !isNodeOfType(receiver, "Identifier") ||
        receiver.name !== "document" ||
        !context.scopes.isGlobalReference(receiver)
      ) {
        return null;
      }
      const argumentKeys = expression.arguments.map((argument) =>
        isNodeOfType(argument as EsTreeNode, "SpreadElement")
          ? null
          : serializeExpression(argument as EsTreeNode),
      );
      return argumentKeys.every((argumentKey) => argumentKey !== null)
        ? `document.getElementById(${argumentKeys.join(",")})`
        : null;
    }
    return null;
  };

  const targetKey = serializeExpression(targetArgument);
  if (!targetKey) return null;
  visitedSymbolIds.clear();
  const guardKeys: string[] = [];
  let child: EsTreeNode = methodCall;
  let ancestor = methodCall.parent ?? null;
  while (ancestor && ancestor !== iteratorCallback) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      const branchPolarity = ancestor.consequent === child ? "truthy" : "falsy";
      const guardKey = serializeExpression(ancestor.test);
      if (!guardKey) return null;
      guardKeys.push(`${branchPolarity}:${guardKey}`);
    } else if (
      isNodeOfType(ancestor, "ConditionalExpression") ||
      isNodeOfType(ancestor, "LogicalExpression") ||
      isNodeOfType(ancestor, "SwitchStatement") ||
      isNodeOfType(ancestor, "ForStatement") ||
      isNodeOfType(ancestor, "ForInStatement") ||
      isNodeOfType(ancestor, "ForOfStatement") ||
      isNodeOfType(ancestor, "WhileStatement") ||
      isNodeOfType(ancestor, "DoWhileStatement")
    ) {
      return null;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  if (ancestor !== iteratorCallback) return null;
  return `${collectionKey}:${guardKeys.join("&")}:${targetKey}`;
};

const recordObserverUsage = (
  identifier: EsTreeNodeOfType<"Identifier">,
  tracked: TrackedObserver,
  context: RuleContext,
): void => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (binding && !tracked.bindingIdentifiers.has(binding.bindingIdentifier)) return;
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const parent = referenceRoot.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.id === identifier) return;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === referenceRoot) return;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.property === identifier &&
    !parent.computed
  )
    return;
  if (
    isNodeOfType(parent, "Property") &&
    parent.key === identifier &&
    parent.value !== identifier &&
    !parent.computed
  ) {
    return;
  }
  if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot) {
    const accessedMethodName = getStaticPropertyName(parent);
    if (parent.computed && accessedMethodName === null) {
      tracked.didEscape = true;
      return;
    }
    const methodCall = parent.parent;
    if (!isNodeOfType(methodCall, "CallExpression") || methodCall.callee !== parent) return;
    if (accessedMethodName === "observe") {
      tracked.didObserve = true;
      tracked.didReleaseAll = false;
      tracked.observationCalls.push(methodCall);
      const targetArgument = methodCall.arguments?.[0];
      const iterationTargetKey = targetArgument
        ? serializeForEachTarget(methodCall, targetArgument as EsTreeNode, context)
        : null;
      const targetKey = targetArgument
        ? serializeReferenceKey({ node: targetArgument, scopes: context.scopes })
        : null;
      if (iterationTargetKey) tracked.observedIterationTargetKeys.add(iterationTargetKey);
      else if (targetKey) tracked.observedTargetKeys.add(targetKey);
      else tracked.didObserveUnknownTarget = true;
      return;
    }
    if (accessedMethodName === "disconnect" && tracked.didObserve) {
      tracked.didReleaseAll = true;
      tracked.didObserveUnknownTarget = false;
      tracked.observedIterationTargetKeys.clear();
      tracked.observedTargetKeys.clear();
      return;
    }
    if (accessedMethodName === "unobserve" && tracked.didObserve) {
      const targetArgument = methodCall.arguments?.[0];
      const iterationTargetKey = targetArgument
        ? serializeForEachTarget(methodCall, targetArgument as EsTreeNode, context)
        : null;
      const targetKey = targetArgument
        ? serializeReferenceKey({ node: targetArgument, scopes: context.scopes })
        : null;
      if (iterationTargetKey && tracked.observedIterationTargetKeys.has(iterationTargetKey)) {
        tracked.observedIterationTargetKeys.delete(iterationTargetKey);
      } else if (targetKey && tracked.observedTargetKeys.has(targetKey)) {
        tracked.observedTargetKeys.delete(targetKey);
      }
    }
    return;
  }
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === referenceRoot)
  ) {
    const bindCallee = stripParenExpression(parent.callee);
    if (
      isNodeOfType(bindCallee, "MemberExpression") &&
      getStaticPropertyName(bindCallee) === "bind" &&
      parent.arguments[0] === referenceRoot
    ) {
      return;
    }
  }
  tracked.didEscape = true;
};

// One-shot observers release themselves through the callback's SECOND
// parameter — `new IntersectionObserver((entries, obs) => { ...
// obs.disconnect() })` — the spec-provided reference to the observer
// itself. A release through that alias is as real as one through the
// binding.
const expressionReferencesBinding = (
  expression: EsTreeNode,
  bindingIdentifier: EsTreeNode,
  scopes: RuleContext["scopes"],
): boolean => {
  let didReferenceBinding = false;
  walkSynchronousCallbackFlow(expression, (child) => {
    if (
      isNodeOfType(child, "Identifier") &&
      scopes.symbolFor(child)?.bindingIdentifier === bindingIdentifier
    ) {
      didReferenceBinding = true;
    }
  });
  return didReferenceBinding;
};

const isObserverEntryTarget = (
  expression: EsTreeNode,
  observerCallback: EsTreeNode,
  entriesBindingIdentifier: EsTreeNode | null,
  scopes: RuleContext["scopes"],
): boolean => {
  if (!entriesBindingIdentifier) return false;
  const targetMember = stripParenExpression(expression);
  if (
    !isNodeOfType(targetMember, "MemberExpression") ||
    getStaticPropertyName(targetMember) !== "target"
  ) {
    return false;
  }
  const entryExpression = stripParenExpression(targetMember.object);
  if (!isNodeOfType(entryExpression, "Identifier")) return false;
  const entryBinding = scopes.symbolFor(entryExpression)?.bindingIdentifier;
  if (!entryBinding) return false;
  const iteratorCallback = findEnclosingFunction(entryExpression);
  if (
    !iteratorCallback ||
    iteratorCallback === observerCallback ||
    !isFunctionLike(iteratorCallback)
  ) {
    return false;
  }
  const callbackRoot = findTransparentExpressionRoot(iteratorCallback);
  const iteratorCall = callbackRoot.parent;
  if (
    !isNodeOfType(iteratorCall, "CallExpression") ||
    !iteratorCall.arguments.some((argument) => argument === callbackRoot)
  ) {
    return false;
  }
  const iteratorCallee = stripParenExpression(iteratorCall.callee);
  return (
    isNodeOfType(iteratorCallee, "MemberExpression") &&
    getStaticPropertyName(iteratorCallee) === "forEach" &&
    expressionReferencesBinding(iteratorCallee.object, entriesBindingIdentifier, scopes) &&
    (iteratorCallback.params ?? []).some(
      (parameter: EsTreeNode) => scopes.symbolFor(parameter)?.bindingIdentifier === entryBinding,
    )
  );
};

const collectCallbackObserverRelease = (
  construction: EsTreeNodeOfType<"NewExpression">,
  scopes: RuleContext["scopes"],
): CallbackObserverRelease => {
  const release: CallbackObserverRelease = {
    didReleaseAll: false,
    didReleaseObservedEntries: false,
    releasedTargetKeys: new Set(),
  };
  const observerCallback = construction.arguments?.[0]
    ? stripParenExpression(construction.arguments[0] as EsTreeNode)
    : null;
  if (
    !observerCallback ||
    (!isNodeOfType(observerCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(observerCallback, "FunctionExpression"))
  ) {
    return release;
  }
  const callbackFunction = observerCallback;
  const entriesParameter = callbackFunction.params?.[0];
  const entriesBindingIdentifier = entriesParameter
    ? (scopes.symbolFor(entriesParameter as EsTreeNode)?.bindingIdentifier ?? null)
    : null;
  const observerParameter = callbackFunction.params?.[1];
  if (!observerParameter || !isNodeOfType(observerParameter as EsTreeNode, "Identifier")) {
    return release;
  }
  const parameterBindingIdentifier = scopes.symbolFor(
    observerParameter as EsTreeNode,
  )?.bindingIdentifier;
  if (!parameterBindingIdentifier) return release;
  walkSynchronousCallbackFlow(callbackFunction, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const receiver = stripParenExpression(callee.object as EsTreeNode);
    if (
      !isNodeOfType(receiver, "Identifier") ||
      scopes.symbolFor(receiver)?.bindingIdentifier !== parameterBindingIdentifier
    ) {
      return;
    }
    const releaseMethodName = getStaticPropertyName(callee);
    if (releaseMethodName === "disconnect") {
      release.didReleaseAll = true;
      return;
    }
    if (releaseMethodName !== "unobserve") return;
    const targetArgument = child.arguments?.[0];
    if (!targetArgument) return;
    if (
      isObserverEntryTarget(
        targetArgument as EsTreeNode,
        callbackFunction,
        entriesBindingIdentifier,
        scopes,
      )
    ) {
      release.didReleaseObservedEntries = true;
      return;
    }
    const targetKey = serializeReferenceKey({
      node: targetArgument as EsTreeNode,
      scopes,
    });
    if (targetKey) release.releasedTargetKeys.add(targetKey);
  });
  return release;
};

const isTrackedObserverReference = (
  expression: EsTreeNode,
  bindingIdentifiers: ReadonlySet<EsTreeNode>,
): boolean => {
  const reference = stripParenExpression(expression);
  const bindingIdentifier = isNodeOfType(reference, "Identifier")
    ? findVariableInitializer(reference, reference.name)?.bindingIdentifier
    : null;
  return (
    bindingIdentifier !== null &&
    bindingIdentifier !== undefined &&
    bindingIdentifiers.has(bindingIdentifier)
  );
};

const isBoundObserverDisconnect = (
  returnExpression: EsTreeNode,
  bindingIdentifiers: ReadonlySet<EsTreeNode>,
  visitedExpressions = new Set<EsTreeNode>(),
): boolean => {
  const expression = stripParenExpression(returnExpression);
  if (visitedExpressions.has(expression)) return false;
  visitedExpressions.add(expression);
  if (isNodeOfType(expression, "Identifier")) {
    const initializer = findVariableInitializer(expression, expression.name)?.initializer;
    return initializer
      ? isBoundObserverDisconnect(initializer, bindingIdentifiers, visitedExpressions)
      : false;
  }
  const callee = isNodeOfType(expression, "CallExpression")
    ? stripParenExpression(expression.callee)
    : null;
  const boundMethod = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : null;
  if (
    !isNodeOfType(expression, "CallExpression") ||
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "bind" ||
    !isNodeOfType(boundMethod, "MemberExpression") ||
    getStaticPropertyName(boundMethod) !== "disconnect"
  ) {
    return false;
  }
  const boundReceiver = expression.arguments?.[0];
  return Boolean(
    boundReceiver &&
    isTrackedObserverReference(boundMethod.object, bindingIdentifiers) &&
    isTrackedObserverReference(boundReceiver, bindingIdentifiers),
  );
};

const findRetainedObserverCollectionKey = (
  tracked: TrackedObserver,
  context: RuleContext,
): string | null => {
  const pushCalls = new Set<EsTreeNodeOfType<"CallExpression">>();
  for (const bindingIdentifier of tracked.bindingIdentifiers) {
    const symbol = context.scopes.symbolFor(bindingIdentifier);
    if (!symbol) continue;
    for (const reference of symbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const callExpression = referenceRoot.parent;
      if (
        !isNodeOfType(callExpression, "CallExpression") ||
        !callExpression.arguments.some((argument) => argument === referenceRoot)
      ) {
        continue;
      }
      const callee = stripParenExpression(callExpression.callee);
      if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "push") {
        pushCalls.add(callExpression);
      }
    }
  }
  if (pushCalls.size !== 1) return null;
  const pushCall = [...pushCalls][0];
  if (
    !pushCall ||
    tracked.observationCalls.some(
      (observationCall) => !doNodesCoverEveryPathAfterNode(observationCall, [pushCall], context),
    )
  ) {
    return null;
  }
  const pushCallee = stripParenExpression(pushCall.callee);
  if (!isNodeOfType(pushCallee, "MemberExpression")) return null;
  const collection = stripParenExpression(pushCallee.object);
  if (!isNodeOfType(collection, "Identifier")) return null;
  const collectionSymbol = context.scopes.symbolFor(collection);
  const collectionInitializer = collectionSymbol?.initializer
    ? stripParenExpression(collectionSymbol.initializer)
    : null;
  if (
    !collectionSymbol ||
    collectionSymbol.kind !== "const" ||
    !isNodeOfType(collectionInitializer, "ArrayExpression") ||
    (collectionInitializer.elements?.length ?? 0) !== 0 ||
    findEnclosingFunction(collectionSymbol.declarationNode) !==
      findEnclosingFunction(tracked.construction)
  ) {
    return null;
  }
  const hasOnlyRetentionAndIteration = collectionSymbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const memberExpression = referenceRoot.parent;
    const callExpression = memberExpression?.parent;
    return Boolean(
      isNodeOfType(memberExpression, "MemberExpression") &&
      memberExpression.object === referenceRoot &&
      isNodeOfType(callExpression, "CallExpression") &&
      callExpression.callee === memberExpression &&
      ["forEach", "push"].includes(getStaticPropertyName(memberExpression) ?? ""),
    );
  });
  if (!hasOnlyRetentionAndIteration) return null;
  return serializeReferenceKey({ node: collection, scopes: context.scopes });
};

const doesCallbackDisconnectEachObserver = (
  callback: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  const observerParameter = callback.params?.[0];
  if (!observerParameter || !isNodeOfType(observerParameter, "Identifier")) return false;
  const observerBinding = context.scopes.symbolFor(observerParameter)?.bindingIdentifier;
  if (!observerBinding) return false;
  const disconnectCalls: EsTreeNode[] = [];
  walkSynchronousCallbackFlow(callback, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      getStaticPropertyName(callee) !== "disconnect"
    ) {
      return;
    }
    const receiver = stripParenExpression(callee.object);
    if (
      isNodeOfType(receiver, "Identifier") &&
      context.scopes.symbolFor(receiver)?.bindingIdentifier === observerBinding
    ) {
      disconnectCalls.push(child);
    }
  });
  return doNodesCoverEveryPathFromFunctionEntry(callback, disconnectCalls, context);
};

const doesReturnedCleanupDisconnectCollection = (
  effectCallback: EsTreeNode,
  observationCalls: ReadonlyArray<EsTreeNode>,
  collectionKey: string,
  context: RuleContext,
): boolean => {
  const doesCleanupFunctionDisconnectCollection = (cleanupFunction: EsTreeNode): boolean => {
    if (!isFunctionLike(cleanupFunction) || cleanupFunction.async || cleanupFunction.generator) {
      return false;
    }
    const matchingForEachCalls: EsTreeNode[] = [];
    walkAst(cleanupFunction.body, (child) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      if (findEnclosingFunction(child) !== cleanupFunction) return;
      const callee = stripParenExpression(child.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        getStaticPropertyName(callee) !== "forEach" ||
        serializeReferenceKey({ node: callee.object, scopes: context.scopes }) !== collectionKey
      ) {
        return;
      }
      const callback = child.arguments?.[0];
      if (callback && doesCallbackDisconnectEachObserver(callback, context)) {
        matchingForEachCalls.push(child);
      }
    });
    return doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, matchingForEachCalls, context);
  };
  if (!isFunctionLike(effectCallback)) return false;
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    const cleanupFunctions = resolveCleanupFunctions(
      effectCallback.body,
      effectCallback,
      context.scopes,
    );
    return (
      cleanupFunctions.length > 0 && cleanupFunctions.every(doesCleanupFunctionDisconnectCollection)
    );
  }
  const matchingCleanupReturns = collectFunctionReturnStatements(effectCallback).filter(
    (returnStatement) => {
      if (!returnStatement.argument) return false;
      const cleanupFunctions = resolveCleanupFunctions(
        returnStatement.argument,
        returnStatement,
        context.scopes,
      );
      return (
        cleanupFunctions.length > 0 &&
        cleanupFunctions.every(doesCleanupFunctionDisconnectCollection)
      );
    },
  );
  return observationCalls.every((observationCall) =>
    doNodesCoverEveryPathAfterNode(observationCall, matchingCleanupReturns, context),
  );
};

export const effectObserverNeedsDisconnect = defineRule({
  id: "effect-observer-needs-disconnect",
  title: "Observer created in an effect never disconnected",
  severity: "error",
  category: "Bugs",
  recommendation:
    "Return a cleanup function that calls `observer.disconnect()` (or `observer.unobserve(node)`) so the observer stops firing callbacks against detached nodes after unmount instead of leaking on every mount.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isProvenEffectHookCall(node, context.scopes)) return;
      const callback = getEffectCallback(node);
      if (!isFunctionLike(callback)) return;

      const trackedObserversByBinding = new Map<EsTreeNode, TrackedObserver>();
      walkSynchronousCallbackFlow(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "NewExpression")) return;
        const constructorCallee = stripParenExpression(child.callee);
        const isObserverConstructor = isNodeOfType(constructorCallee, "Identifier")
          ? EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(constructorCallee.name) &&
            !findVariableInitializer(constructorCallee, constructorCallee.name)
          : isNodeOfType(constructorCallee, "MemberExpression") &&
            isNodeOfType(
              stripParenExpression(constructorCallee.object as EsTreeNode),
              "Identifier",
            ) &&
            GLOBAL_OBJECT_NAMES.has(
              (
                stripParenExpression(
                  constructorCallee.object as EsTreeNode,
                ) as EsTreeNodeOfType<"Identifier">
              ).name,
            ) &&
            !findVariableInitializer(
              constructorCallee.object as EsTreeNode,
              (
                stripParenExpression(
                  constructorCallee.object as EsTreeNode,
                ) as EsTreeNodeOfType<"Identifier">
              ).name,
            ) &&
            EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(getStaticPropertyName(constructorCallee) ?? "");
        if (!isObserverConstructor) return;
        const expressionRoot = findTransparentExpressionRoot(child);
        const declarator = expressionRoot.parent;
        if (!isNodeOfType(declarator, "VariableDeclarator") || declarator.init !== expressionRoot)
          return;
        const bindingName = isNodeOfType(declarator.id, "Identifier") ? declarator.id.name : null;
        if (!bindingName) return;
        const callbackRelease = collectCallbackObserverRelease(child, context.scopes);
        trackedObserversByBinding.set(declarator.id, {
          construction: child,
          bindingIdentifier: declarator.id,
          bindingIdentifiers: new Set([declarator.id]),
          didObserve: false,
          didObserveUnknownTarget: false,
          didReleaseAll: false,
          didReleaseAllViaCallbackParameter:
            callbackRelease.didReleaseAll || callbackRelease.didReleaseObservedEntries,
          callbackReleasedTargetKeys: callbackRelease.releasedTargetKeys,
          didEscape: false,
          observationCalls: [],
          observedIterationTargetKeys: new Set(),
          observedTargetKeys: new Set(),
        });
      });
      if (trackedObserversByBinding.size === 0) return;

      for (const tracked of [...trackedObserversByBinding.values()]) {
        const bindingIdentifiers = collectBindingAliases(tracked.bindingIdentifier, context.scopes);
        tracked.bindingIdentifiers = new Set(bindingIdentifiers);
        for (const bindingIdentifier of bindingIdentifiers) {
          trackedObserversByBinding.set(bindingIdentifier, tracked);
        }
      }
      const trackedObservers = new Set(trackedObserversByBinding.values());

      walkSynchronousCallbackFlow(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "Identifier")) return;
        const bindingIdentifier = findVariableInitializer(child, child.name)?.bindingIdentifier;
        const tracked = bindingIdentifier
          ? trackedObserversByBinding.get(bindingIdentifier)
          : undefined;
        if (tracked) recordObserverUsage(child, tracked, context);
      });

      for (const cleanupFunction of collectReturnedCleanupFunctions(callback)) {
        walkSynchronousCallbackFlow(cleanupFunction, (child: EsTreeNode) => {
          if (!isNodeOfType(child, "Identifier")) return;
          const bindingIdentifier = findVariableInitializer(child, child.name)?.bindingIdentifier;
          const tracked = bindingIdentifier
            ? trackedObserversByBinding.get(bindingIdentifier)
            : undefined;
          if (tracked) recordObserverUsage(child, tracked, context);
        });
      }

      for (const tracked of trackedObservers) {
        for (const releasedTargetKey of tracked.callbackReleasedTargetKeys) {
          tracked.observedTargetKeys.delete(releasedTargetKey);
        }
        const observerCallback = tracked.construction.arguments?.[0];
        if (!observerCallback || !isFunctionLike(stripParenExpression(observerCallback))) continue;
        const callbackFunction = stripParenExpression(observerCallback);
        walkSynchronousCallbackFlow(callbackFunction, (child: EsTreeNode) => {
          if (!isNodeOfType(child, "Identifier")) return;
          const bindingIdentifier = findVariableInitializer(child, child.name)?.bindingIdentifier;
          if (bindingIdentifier && trackedObserversByBinding.get(bindingIdentifier) === tracked) {
            recordObserverUsage(child, tracked, context);
          }
        });
      }

      const returnedExpressions = isNodeOfType(callback.body, "BlockStatement")
        ? collectFunctionReturnStatements(callback).flatMap((returnStatement) =>
            returnStatement.argument ? [returnStatement.argument] : [],
          )
        : [callback.body];
      for (const tracked of trackedObservers) {
        if (
          returnedExpressions.some((returnExpression) =>
            isBoundObserverDisconnect(returnExpression, tracked.bindingIdentifiers),
          )
        ) {
          tracked.didReleaseAll = true;
          tracked.didObserveUnknownTarget = false;
          tracked.observedIterationTargetKeys.clear();
          tracked.observedTargetKeys.clear();
        }
        const didReleaseEveryActiveTarget =
          !tracked.didObserveUnknownTarget &&
          tracked.observedIterationTargetKeys.size === 0 &&
          tracked.observedTargetKeys.size === 0;
        if (
          !tracked.didObserve ||
          tracked.didReleaseAll ||
          tracked.didReleaseAllViaCallbackParameter ||
          didReleaseEveryActiveTarget
        ) {
          continue;
        }
        const retainedCollectionKey = findRetainedObserverCollectionKey(tracked, context);
        if (
          retainedCollectionKey &&
          doesReturnedCleanupDisconnectCollection(
            callback,
            tracked.observationCalls,
            retainedCollectionKey,
            context,
          )
        ) {
          continue;
        }
        context.report({
          node: tracked.construction,
          message:
            "This observer is created and started in the effect but never disconnected, so it keeps firing against detached nodes and leaks one observer per mount; return a cleanup that calls `disconnect()` or `unobserve()`.",
        });
      }
    },
  }),
});
