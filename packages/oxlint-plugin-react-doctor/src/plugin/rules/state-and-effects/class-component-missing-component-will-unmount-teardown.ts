import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../utils/do-nodes-cover-every-path-from-function-entry.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import { serializeEventKey } from "../../utils/serialize-event-key.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const MESSAGE =
  "This class registers a listener or timer on mount but declares no `componentWillUnmount`, so the subscription/timer keeps firing after the component unmounts; release it in `componentWillUnmount`.";

// Listener-registration methods that hand back a resource which must be
// explicitly removed on unmount. Sound: each has a matching removal API.
const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "global", "self"]);
const MOUNT_LOCAL_RESOURCE_FACTORY_NAMES = new Set(["initPlaces", "places"]);
const COMPONENT_MUTATION_METHOD_NAMES = new Set(["forceUpdate", "setState"]);
const MOBX_REACT_MODULE = "mobx-react";
const DISPOSE_ON_UNMOUNT_NAME = "disposeOnUnmount";

interface ListenerMethodSignature {
  releaseMethodName: string;
  identityArgumentKinds: ReadonlyArray<"event" | "handler">;
  captureOptionsIndex?: number;
}

const LISTENER_REGISTRATION_SIGNATURES = new Map<string, ListenerMethodSignature>([
  [
    "addEventListener",
    {
      releaseMethodName: "removeEventListener",
      identityArgumentKinds: ["event", "handler"],
      captureOptionsIndex: 2,
    },
  ],
  [
    "addListener",
    { releaseMethodName: "removeListener", identityArgumentKinds: ["event", "handler"] },
  ],
  ["on", { releaseMethodName: "off", identityArgumentKinds: ["event", "handler"] }],
  ["once", { releaseMethodName: "off", identityArgumentKinds: ["event", "handler"] }],
  ["subscribe", { releaseMethodName: "unsubscribe", identityArgumentKinds: ["handler"] }],
]);
const LISTENER_RELEASE_SIGNATURES = new Map<string, ListenerMethodSignature>([
  [
    "removeEventListener",
    {
      releaseMethodName: "removeEventListener",
      identityArgumentKinds: ["event", "handler"],
      captureOptionsIndex: 2,
    },
  ],
  [
    "removeListener",
    { releaseMethodName: "removeListener", identityArgumentKinds: ["event", "handler"] },
  ],
  ["off", { releaseMethodName: "off", identityArgumentKinds: ["event", "handler"] }],
  ["unsubscribe", { releaseMethodName: "unsubscribe", identityArgumentKinds: ["handler"] }],
]);

interface MountHazard {
  node: EsTreeNodeOfType<"CallExpression">;
  releaseKey: string | null;
}

const getBareCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  return isNodeOfType(callee, "Identifier") ? callee.name : null;
};

const isImportedMobxRunInActionCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const calleeName = getBareCalleeName(node);
  const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
  return Boolean(
    calleeName &&
    isNodeOfType(callee, "Identifier") &&
    scopes.symbolFor(callee)?.kind === "import" &&
    getImportedNameFromModule(node, calleeName, "mobx") === "runInAction",
  );
};

// Timers are registered either bare (`setInterval(...)`) or via the global
// object (`window.setInterval(...)`, the TS idiom for a `number` timer id).
const getTimerCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  const bareName = getBareCalleeName(node);
  if (
    bareName &&
    isNodeOfType(callee, "Identifier") &&
    !findVariableInitializer(callee, bareName)
  ) {
    return bareName;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    !GLOBAL_OBJECT_NAMES.has(receiver.name) ||
    findVariableInitializer(receiver, receiver.name)
  ) {
    return null;
  }
  return getStaticPropertyName(callee);
};

const getClassMemberName = (member: EsTreeNode): string | null => {
  if (isNodeOfType(member, "MethodDefinition") && member.kind === "constructor") {
    return "constructor";
  }
  return getStaticPropertyKeyName(member, { allowComputedString: true });
};

// A `setTimeout` is a hazard only when its callback actually mutates the
// component — `this.setState(...)`, `runInAction(...)`, or any direct
// `this.<action>(...)` call. A one-shot field write (`this.x = true`) or a
// ref/focus nudge (`this.inputRef.current?.focus()`) leaks nothing.
const classMemberFunction = (
  classBody: EsTreeNode | null,
  memberName: string,
): EsTreeNode | null => {
  if (!classBody || !isNodeOfType(classBody, "ClassBody")) return null;
  for (const member of classBody.body ?? []) {
    const candidate = member as EsTreeNode;
    if (
      (isNodeOfType(candidate, "MethodDefinition") ||
        isNodeOfType(candidate, "PropertyDefinition")) &&
      getClassMemberName(candidate) === memberName &&
      candidate.value &&
      isFunctionLike(candidate.value as EsTreeNode)
    ) {
      return candidate.value as EsTreeNode;
    }
  }
  return null;
};

const functionSetsComponentState = (
  functionNode: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedFunctions.has(functionNode)) return false;
  visitedFunctions.add(functionNode);
  let mutates = false;
  walkSynchronousCallbackFlow(functionNode, (node: EsTreeNode) => {
    if (mutates) return false;
    if (isImportedMobxRunInActionCall(node, scopes)) {
      mutates = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      return;
    }
    const memberName = getStaticPropertyName(callee);
    if (memberName && COMPONENT_MUTATION_METHOD_NAMES.has(memberName)) {
      mutates = true;
      return false;
    }
    const nestedFunction = memberName ? classMemberFunction(classBody, memberName) : null;
    if (
      nestedFunction &&
      functionSetsComponentState(nestedFunction, classBody, scopes, visitedFunctions)
    ) {
      mutates = true;
      return false;
    }
  });
  return mutates;
};

const resolveTimeoutCallbackFunction = (
  callback: EsTreeNode,
  classBody: EsTreeNode | null,
  visitedExpressions = new Set<EsTreeNode>(),
): EsTreeNode | null => {
  const expression = stripParenExpression(callback);
  if (visitedExpressions.has(expression)) return null;
  visitedExpressions.add(expression);
  if (isFunctionLike(expression)) return expression;
  if (isNodeOfType(expression, "Identifier")) {
    const initializer = findVariableInitializer(expression, expression.name)?.initializer;
    return initializer
      ? resolveTimeoutCallbackFunction(initializer, classBody, visitedExpressions)
      : null;
  }
  const callee = isNodeOfType(expression, "CallExpression")
    ? stripParenExpression(expression.callee)
    : null;
  const boundTarget =
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "bind" &&
    expression.arguments?.[0] &&
    isNodeOfType(stripParenExpression(expression.arguments[0] as EsTreeNode), "ThisExpression")
      ? stripParenExpression(callee.object)
      : null;
  const methodReference = boundTarget ?? expression;
  const memberName =
    isNodeOfType(methodReference, "MemberExpression") &&
    isNodeOfType(stripParenExpression(methodReference.object), "ThisExpression")
      ? getStaticPropertyName(methodReference)
      : null;
  return memberName ? classMemberFunction(classBody, memberName) : null;
};

const timeoutCallbackMutatesComponent = (
  callback: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  const resolvedCallback = resolveTimeoutCallbackFunction(callback, classBody);
  if (!isFunctionLike(resolvedCallback)) return false;
  const body = resolvedCallback.body;
  if (!body) return false;
  let mutates = false;
  walkSynchronousCallbackFlow(body, (node) => {
    if (mutates) return;
    if (isImportedMobxRunInActionCall(node, scopes)) {
      mutates = true;
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      // `this.focusInput()` — resolve the instance method; a ref/DOM nudge
      // that never calls setState/runInAction mutates nothing when it
      // fires after unmount.
      const memberName = getStaticPropertyName(callee);
      if (memberName && COMPONENT_MUTATION_METHOD_NAMES.has(memberName)) {
        mutates = true;
        return;
      }
      const memberFunction = memberName ? classMemberFunction(classBody, memberName) : null;
      if (memberFunction && !functionSetsComponentState(memberFunction, classBody, scopes)) return;
      mutates = true;
    }
  });
  return mutates;
};

// `addEventListener(..., { once: true })` self-removes after firing, so there
// is usually nothing left to release on unmount.
const isOneShotListenerOptions = (
  optionsArgument: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!optionsArgument) return false;
  const optionsObject = resolveStableOptionsObject(optionsArgument, ["once"], scopes);
  if (!optionsObject) return false;
  return (optionsObject.properties ?? []).some(
    (property: EsTreeNode) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "once" &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === true,
  );
};

// Variables declared inside the synchronous mount flow whose values never
// escape it (never assigned onto `this` or another object): a listener
// registered on such a locally constructed emitter dies with the component,
// so it needs no teardown.
const collectMountLocalReceiverSymbolIds = (
  mountBody: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<number> => {
  const declaredSymbolIds = new Set<number>();
  const escapedSymbolIds = new Set<number>();
  walkSynchronousCallbackFlow(mountBody, (node) => {
    if (isNodeOfType(node, "VariableDeclarator")) {
      const initializer = node.init ? stripParenExpression(node.init as EsTreeNode) : null;
      const initializerCallee = isNodeOfType(initializer, "CallExpression")
        ? stripParenExpression(initializer.callee)
        : null;
      if (
        initializer &&
        (isNodeOfType(initializer, "NewExpression") ||
          isNodeOfType(initializer, "ObjectExpression") ||
          isNodeOfType(initializer, "ArrayExpression") ||
          (isNodeOfType(initializer, "CallExpression") &&
            isNodeOfType(initializerCallee, "Identifier") &&
            MOUNT_LOCAL_RESOURCE_FACTORY_NAMES.has(initializerCallee.name)))
      ) {
        const declaredNames = new Set<string>();
        collectPatternNames(node.id as EsTreeNode, declaredNames);
        const declarationScope = scopes.scopeFor(node);
        for (const declaredName of declaredNames) {
          const symbol = declarationScope.symbolsByName.get(declaredName);
          if (symbol) declaredSymbolIds.add(symbol.id);
        }
      }
    }
    if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
      const assignedValue = stripParenExpression(node.right);
      const assignedSymbol = isNodeOfType(assignedValue, "Identifier")
        ? scopes.symbolFor(assignedValue)
        : null;
      if (assignedSymbol) escapedSymbolIds.add(assignedSymbol.id);
    }
    if (isNodeOfType(node, "CallExpression")) {
      for (const argument of node.arguments ?? []) {
        const argumentExpression = stripParenExpression(argument as EsTreeNode);
        const argumentSymbol = isNodeOfType(argumentExpression, "Identifier")
          ? scopes.symbolFor(argumentExpression)
          : null;
        if (argumentSymbol && declaredSymbolIds.has(argumentSymbol.id)) {
          escapedSymbolIds.add(argumentSymbol.id);
        }
      }
    }
  });
  for (const escapedSymbolId of escapedSymbolIds) declaredSymbolIds.delete(escapedSymbolId);
  return declaredSymbolIds;
};

// `addEventListener` immediately paired with `removeEventListener` for the
// same event in the same mount body (passive-support detection) leaves
// nothing registered.
const serializeListenerIdentityPart = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return JSON.stringify(expression.value);
  return serializeReferenceKey({ node: expression, scopes });
};

const opaqueCaptureOptionsKey = (options: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const expression = stripParenExpression(options);
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    hasSymbolWriteBefore(symbol, expression, scopes) ||
    hasPossibleStaticPropertyWriteBefore(expression, "capture", expression, scopes)
  ) {
    return null;
  }
  const referenceKey = serializeReferenceKey({ node: expression, scopes });
  return referenceKey ? `options:${referenceKey}` : null;
};

const listenerIdentityKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  signature: ListenerMethodSignature,
  scopes: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const maximumArgumentCount =
    signature.captureOptionsIndex === undefined
      ? signature.identityArgumentKinds.length
      : signature.captureOptionsIndex + 1;
  if (
    call.arguments.length < signature.identityArgumentKinds.length ||
    call.arguments.length > maximumArgumentCount
  ) {
    return null;
  }
  const receiverKey = serializeListenerIdentityPart(callee.object, scopes);
  if (!receiverKey) return null;
  const identityArgumentKeys: string[] = [];
  for (const [argumentIndex, argumentKind] of signature.identityArgumentKinds.entries()) {
    const argument = call.arguments?.[argumentIndex];
    if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
    const argumentKey =
      argumentKind === "event"
        ? serializeEventKey(argument, scopes)
        : serializeListenerIdentityPart(argument, scopes);
    if (!argumentKey) return null;
    identityArgumentKeys.push(argumentKey);
  }
  const identityKey = `${receiverKey}|${identityArgumentKeys.join("|")}`;
  if (signature.captureOptionsIndex === undefined) return identityKey;
  const options = call.arguments?.[signature.captureOptionsIndex];
  if (options && isNodeOfType(options, "SpreadElement")) return null;
  let captureKey = "false";
  if (options) {
    const unwrappedOptions = stripParenExpression(options);
    if (isNodeOfType(unwrappedOptions, "Literal") && typeof unwrappedOptions.value === "boolean") {
      captureKey = String(unwrappedOptions.value);
    } else {
      const optionsObject = resolveStableOptionsObject(options, ["capture"], scopes);
      const opaqueOptionsKey = opaqueCaptureOptionsKey(options, scopes);
      if (!optionsObject) return opaqueOptionsKey ? `${identityKey}|${opaqueOptionsKey}` : null;
      if (
        optionsObject.properties.some(
          (property) =>
            !isNodeOfType(property, "Property") ||
            getStaticPropertyKeyName(property, { allowComputedString: true }) === null,
        )
      ) {
        return opaqueOptionsKey ? `${identityKey}|${opaqueOptionsKey}` : null;
      }
      const captureProperty = optionsObject.properties.find(
        (property) =>
          isNodeOfType(property, "Property") &&
          getStaticPropertyKeyName(property, { allowComputedString: true }) === "capture",
      );
      if (
        captureProperty &&
        isNodeOfType(captureProperty, "Property") &&
        isNodeOfType(captureProperty.value, "Literal") &&
        typeof captureProperty.value.value === "boolean"
      ) {
        captureKey = String(captureProperty.value.value);
      } else if (captureProperty) {
        return null;
      }
    }
  }
  return `${identityKey}|${captureKey}`;
};

const listenerReleaseKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  signature: ListenerMethodSignature,
  scopes: ScopeAnalysis,
): string | null => {
  const identityKey = listenerIdentityKey(call, signature, scopes);
  return identityKey ? `listener:${signature.releaseMethodName}:${identityKey}` : null;
};

const storedTimerHandleKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const expressionRoot = findTransparentExpressionRoot(call);
  const parent = expressionRoot.parent;
  const storageTarget =
    isNodeOfType(parent, "AssignmentExpression") && parent.right === expressionRoot
      ? parent.left
      : isNodeOfType(parent, "VariableDeclarator") && parent.init === expressionRoot
        ? parent.id
        : null;
  return storageTarget ? serializeReferenceKey({ node: storageTarget, scopes }) : null;
};

const isProvenDisposeOnUnmountCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return (
      scopes.symbolFor(callee)?.kind === "import" &&
      getImportedNameFromModule(call, callee.name, MOBX_REACT_MODULE) === DISPOSE_ON_UNMOUNT_NAME
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    getStaticPropertyName(callee) === DISPOSE_ON_UNMOUNT_NAME &&
    isNodeOfType(receiver, "Identifier") &&
    scopes.symbolFor(receiver)?.kind === "import" &&
    isNamespaceImportFromModule(call, receiver.name, MOBX_REACT_MODULE)
  );
};

const cleanupReleaseKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    const signature = methodName ? LISTENER_RELEASE_SIGNATURES.get(methodName) : undefined;
    if (signature) return listenerReleaseKey(call, signature, scopes);
  }
  const timerCalleeName = getTimerCalleeName(call);
  const handleArgument = call.arguments?.[0];
  if (
    (timerCalleeName === "clearInterval" || timerCalleeName === "clearTimeout") &&
    handleArgument &&
    !isNodeOfType(handleArgument, "SpreadElement")
  ) {
    const handleKey = serializeReferenceKey({ node: handleArgument, scopes });
    return handleKey ? `timer:${timerCalleeName}:${handleKey}` : null;
  }
  return null;
};

const collectMobxDisposalReleaseCalls = (
  mountBody: EsTreeNode,
  classBody: EsTreeNode | null,
  context: RuleContext,
): Map<string, EsTreeNode[]> => {
  const releaseCallsByKey = new Map<string, EsTreeNode[]>();
  walkSynchronousCallbackFlow(mountBody, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const ownerArgument = candidate.arguments?.[0];
    const owner =
      ownerArgument && !isNodeOfType(ownerArgument, "SpreadElement")
        ? stripParenExpression(ownerArgument)
        : null;
    if (
      !isProvenDisposeOnUnmountCall(candidate, context.scopes) ||
      !isNodeOfType(owner, "ThisExpression")
    ) {
      return;
    }
    const cleanupArgument = candidate.arguments?.[1];
    if (!cleanupArgument || isNodeOfType(cleanupArgument, "SpreadElement")) return;
    const cleanupFunction = resolveTimeoutCallbackFunction(cleanupArgument, classBody);
    if (!isFunctionLike(cleanupFunction)) return;
    const cleanupCallsByKey = new Map<string, EsTreeNode[]>();
    walkSynchronousCallbackFlow(cleanupFunction, (cleanupCandidate) => {
      if (!isNodeOfType(cleanupCandidate, "CallExpression")) return;
      const releaseKey = cleanupReleaseKey(cleanupCandidate, context.scopes);
      if (!releaseKey) return;
      const cleanupCalls = cleanupCallsByKey.get(releaseKey) ?? [];
      cleanupCalls.push(cleanupCandidate);
      cleanupCallsByKey.set(releaseKey, cleanupCalls);
    });
    for (const [releaseKey, cleanupCalls] of cleanupCallsByKey) {
      if (!doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, cleanupCalls, context)) continue;
      const disposalCalls = releaseCallsByKey.get(releaseKey) ?? [];
      disposalCalls.push(candidate);
      releaseCallsByKey.set(releaseKey, disposalCalls);
    }
  });
  return releaseCallsByKey;
};

const collectCleanupReleaseKeys = (
  cleanupFunction: EsTreeNode | null,
  context: RuleContext,
): Set<string> => {
  const releaseKeys = new Set<string>();
  if (!cleanupFunction || !isFunctionLike(cleanupFunction)) return releaseKeys;
  const releaseCallsByKey = new Map<string, EsTreeNode[]>();
  walkSynchronousCallbackFlow(cleanupFunction, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const releaseKey = cleanupReleaseKey(candidate, context.scopes);
    if (!releaseKey) return;
    const releaseCalls = releaseCallsByKey.get(releaseKey) ?? [];
    releaseCalls.push(candidate);
    releaseCallsByKey.set(releaseKey, releaseCalls);
  });
  for (const [releaseKey, releaseCalls] of releaseCallsByKey) {
    if (doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, releaseCalls, context)) {
      releaseKeys.add(releaseKey);
    }
  }
  return releaseKeys;
};

const collectSynchronouslyRemovedListeners = (
  mountBody: EsTreeNode,
  scopes: ScopeAnalysis,
): Map<string, number> => {
  const removedListeners = new Map<string, number>();
  walkSynchronousCallbackFlow(mountBody, (node) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    if (getStaticPropertyName(callee) !== "removeEventListener") return;
    const signature = LISTENER_RELEASE_SIGNATURES.get("removeEventListener");
    if (!signature) return;
    const identityKey = listenerIdentityKey(node, signature, scopes);
    if (identityKey) removedListeners.set(identityKey, node.range[0]);
  });
  return removedListeners;
};

const isRefOwnedReceiver = (
  expression: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const symbol = scopes.symbolFor(receiver);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, receiver, scopes)
    ) {
      return false;
    }
    const initializer = findVariableInitializer(receiver, receiver.name)?.initializer;
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isRefOwnedReceiver(initializer, classBody, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(receiver, "MemberExpression")) {
    const propertyName = getStaticPropertyName(receiver);
    const owner = stripParenExpression(receiver.object);
    if (propertyName !== "current") {
      return isRefOwnedReceiver(owner, classBody, scopes, visitedSymbolIds);
    }
    if (!isNodeOfType(classBody, "ClassBody") || !isNodeOfType(owner, "MemberExpression")) {
      return false;
    }
    const refPropertyName = getStaticPropertyName(owner);
    const refOwner = stripParenExpression(owner.object);
    if (!refPropertyName || !isNodeOfType(refOwner, "ThisExpression")) return false;
    const refMember = classBody.body?.find(
      (member) => getClassMemberName(member) === refPropertyName,
    );
    if (
      !refMember ||
      !isNodeOfType(refMember, "PropertyDefinition") ||
      refMember.static ||
      !isNodeOfType(refMember.value, "CallExpression") ||
      !isReactApiCall(refMember.value, "createRef", scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: false,
        resolveNamedAliases: true,
      })
    ) {
      return false;
    }
    let enclosingMember: EsTreeNode | null | undefined = receiver;
    while (enclosingMember && enclosingMember.parent !== classBody) {
      enclosingMember = enclosingMember.parent;
    }
    const enclosingBody = enclosingMember ? getMemberFunctionBody(enclosingMember) : null;
    let wasReassigned = false;
    if (enclosingBody) {
      walkSynchronousCallbackFlow(enclosingBody, (candidate) => {
        if (
          wasReassigned ||
          candidate.range[0] >= receiver.range[0] ||
          !isNodeOfType(candidate, "AssignmentExpression")
        ) {
          return;
        }
        const target = stripParenExpression(candidate.left);
        if (!isNodeOfType(target, "MemberExpression")) return;
        const targetOwner = stripParenExpression(target.object);
        if (
          isNodeOfType(targetOwner, "ThisExpression") &&
          getStaticPropertyName(target) === refPropertyName
        ) {
          wasReassigned = true;
        }
      });
    }
    return !wasReassigned;
  }
  return false;
};

const isD3SelectionRootedAtRefOwnedNode = (
  expression: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const symbol = scopes.symbolFor(receiver);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, receiver, scopes)
    ) {
      return false;
    }
    const initializer = findVariableInitializer(receiver, receiver.name)?.initializer;
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isD3SelectionRootedAtRefOwnedNode(initializer, classBody, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  const callee = stripParenExpression(receiver.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  const calleeReceiver = stripParenExpression(callee.object);
  if (
    (methodName === "select" || methodName === "selectAll") &&
    isNodeOfType(calleeReceiver, "Identifier") &&
    (isNamespaceImportFromModule(receiver, calleeReceiver.name, "d3") ||
      (calleeReceiver.name === "d3" && !scopes.symbolFor(calleeReceiver)))
  ) {
    const selectedNode = receiver.arguments?.[0];
    return Boolean(
      selectedNode &&
      !isNodeOfType(selectedNode, "SpreadElement") &&
      isRefOwnedReceiver(selectedNode, classBody, scopes),
    );
  }
  return isD3SelectionRootedAtRefOwnedNode(callee.object, classBody, scopes, visitedSymbolIds);
};

const isMountHazard = (
  node: EsTreeNode,
  localReceiverSymbolIds: Set<number>,
  removedListeners: Map<string, number>,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
): MountHazard | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  const methodName = isNodeOfType(callee, "MemberExpression")
    ? getStaticPropertyName(callee)
    : null;
  if (
    methodName &&
    LISTENER_REGISTRATION_SIGNATURES.has(methodName) &&
    isNodeOfType(callee, "MemberExpression")
  ) {
    const callArguments = node.arguments ?? [];
    const isFunctionFactoryOnce = methodName === "once" && callArguments.length < 2;
    let receiverBase = stripParenExpression(callee.object);
    const receiverIsRefOwnedNode = isRefOwnedReceiver(receiverBase, classBody, scopes);
    const receiverIsRefOwnedD3Selection = isD3SelectionRootedAtRefOwnedNode(
      receiverBase,
      classBody,
      scopes,
    );
    while (true) {
      receiverBase = stripParenExpression(receiverBase);
      if (isNodeOfType(receiverBase, "CallExpression")) {
        receiverBase = stripParenExpression(receiverBase.callee);
        continue;
      }
      if (isNodeOfType(receiverBase, "MemberExpression")) {
        receiverBase = stripParenExpression(receiverBase.object);
        continue;
      }
      break;
    }
    const receiverSymbol = isNodeOfType(receiverBase, "Identifier")
      ? scopes.symbolFor(receiverBase)
      : null;
    const isLocalReceiver = receiverSymbol ? localReceiverSymbolIds.has(receiverSymbol.id) : false;
    const addEventListenerSignature = LISTENER_REGISTRATION_SIGNATURES.get("addEventListener");
    const listenerKey =
      methodName === "addEventListener" && addEventListenerSignature
        ? listenerIdentityKey(node, addEventListenerSignature, scopes)
        : null;
    const removalPosition = listenerKey ? removedListeners.get(listenerKey) : undefined;
    const isSynchronouslyRemoved = removalPosition !== undefined && removalPosition > node.range[0];
    const isSelfRemovingListener =
      (methodName === "addEventListener" && isOneShotListenerOptions(callArguments[2], scopes)) ||
      isSynchronouslyRemoved;
    const isHazard =
      !isFunctionFactoryOnce &&
      !isLocalReceiver &&
      !isSelfRemovingListener &&
      !receiverIsRefOwnedNode &&
      !receiverIsRefOwnedD3Selection;
    if (!isHazard) return null;
    const signature = LISTENER_REGISTRATION_SIGNATURES.get(methodName);
    return {
      node,
      releaseKey: signature ? listenerReleaseKey(node, signature, scopes) : null,
    };
  }

  const timerCalleeName = getTimerCalleeName(node);
  if (timerCalleeName === "setInterval") {
    const handleKey = storedTimerHandleKey(node, scopes);
    return { node, releaseKey: handleKey ? `timer:clearInterval:${handleKey}` : null };
  }
  if (timerCalleeName === "setTimeout" && node.arguments?.[0]) {
    if (!timeoutCallbackMutatesComponent(node.arguments[0], classBody, scopes)) return null;
    const handleKey = storedTimerHandleKey(node, scopes);
    return { node, releaseKey: handleKey ? `timer:clearTimeout:${handleKey}` : null };
  }
  return null;
};

const getMemberFunction = (member: EsTreeNode): EsTreeNode | null => {
  const isRelevantMember =
    isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition");
  return isRelevantMember && isFunctionLike(member.value) ? member.value : null;
};

const getMemberFunctionBody = (member: EsTreeNode): EsTreeNode | null => {
  const memberFunction = getMemberFunction(member);
  return memberFunction && isFunctionLike(memberFunction) ? (memberFunction.body ?? null) : null;
};

// KNOWN ACCEPTED NOISE: an app-root class component that never unmounts
// (cboard's AppContainer, mounted once via a non-exact `<Route path="/">`
// under ReactDOM.render) registers intentionally app-lifetime listeners,
// yet stays flagged. The mount site lives in a DIFFERENT module
// (src/index.js), so no single-file signal proves root-ness — the
// component's own file only exports a connected class, and name/path
// heuristics ("App", `components/App/`) misfire on route-level screens
// and embeddable widgets that do unmount.
export const classComponentMissingComponentWillUnmountTeardown = defineRule({
  id: "class-component-missing-component-will-unmount-teardown",
  title: "Class component acquires a resource with no teardown",
  severity: "warn",
  category: "Bugs",
  requires: ["react"],
  recommendation:
    "Release listeners and timers acquired in `componentDidMount`/`constructor` by adding a `componentWillUnmount` that removes them (or use MobX `disposeOnUnmount`).",
  create: (context: RuleContext) => ({
    ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
      const classNode = node.parent;
      if (!classNode || !isEs6Component(classNode)) return;

      const members = node.body ?? [];
      const componentWillUnmountMember = members.find(
        (member) => getClassMemberName(member) === "componentWillUnmount",
      );
      const componentWillUnmountReleaseKeys = collectCleanupReleaseKeys(
        componentWillUnmountMember ? getMemberFunction(componentWillUnmountMember) : null,
        context,
      );

      for (const member of members) {
        const memberName = getClassMemberName(member);
        if (memberName !== "constructor" && memberName !== "componentDidMount") continue;
        const body = getMemberFunctionBody(member);
        if (!body) continue;

        const localReceiverSymbolIds = collectMountLocalReceiverSymbolIds(body, context.scopes);
        const removedListeners = collectSynchronouslyRemovedListeners(body, context.scopes);
        const mountHazards: MountHazard[] = [];
        walkSynchronousCallbackFlow(body, (candidate) => {
          const candidateHazard = isMountHazard(
            candidate,
            localReceiverSymbolIds,
            removedListeners,
            node,
            context.scopes,
          );
          if (candidateHazard) mountHazards.push(candidateHazard);
        });
        if (mountHazards.length === 0) continue;
        const mobxDisposalReleaseCalls = collectMobxDisposalReleaseCalls(body, node, context);
        const undisposedHazard = mountHazards.find((mountHazard) => {
          if (!mountHazard.releaseKey) return true;
          if (componentWillUnmountReleaseKeys.has(mountHazard.releaseKey)) return false;
          const disposalCalls = mobxDisposalReleaseCalls.get(mountHazard.releaseKey) ?? [];
          return !doNodesCoverEveryPathAfterNode(mountHazard.node, disposalCalls, context);
        });
        if (undisposedHazard) {
          context.report({ node: undisposedHazard.node, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
