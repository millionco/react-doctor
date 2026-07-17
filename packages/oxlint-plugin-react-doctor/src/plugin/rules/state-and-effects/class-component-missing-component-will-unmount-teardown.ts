import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
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
const LISTENER_REGISTRATION_METHODS = new Set([
  "on",
  "once",
  "subscribe",
  "addEventListener",
  "addListener",
]);

const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "global", "self"]);
const MOUNT_LOCAL_RESOURCE_FACTORY_NAMES = new Set(["initPlaces", "places"]);

const getBareCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  return isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;
};

// Timers are registered either bare (`setInterval(...)`) or via the global
// object (`window.setInterval(...)`, the TS idiom for a `number` timer id).
const getTimerCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const bareName = getBareCalleeName(node);
  if (
    bareName &&
    isNodeOfType(node.callee, "Identifier") &&
    !findVariableInitializer(node.callee, bareName)
  ) {
    return bareName;
  }
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    GLOBAL_OBJECT_NAMES.has(node.callee.object.name) &&
    !findVariableInitializer(node.callee.object, node.callee.object.name)
  ) {
    return getStaticPropertyName(node.callee);
  }
  return null;
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
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedFunctions.has(functionNode)) return false;
  visitedFunctions.add(functionNode);
  let mutates = false;
  walkAst(functionNode, (node: EsTreeNode) => {
    if (mutates) return false;
    if (getBareCalleeName(node) === "runInAction") {
      mutates = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "ThisExpression") &&
      getStaticPropertyName(node.callee) === "setState"
    ) {
      mutates = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "ThisExpression")
    ) {
      const memberName = getStaticPropertyName(node.callee);
      const nestedFunction = memberName ? classMemberFunction(classBody, memberName) : null;
      if (
        nestedFunction &&
        functionSetsComponentState(nestedFunction, classBody, visitedFunctions)
      ) {
        mutates = true;
        return false;
      }
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
  const boundTarget =
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "MemberExpression") &&
    getStaticPropertyName(expression.callee) === "bind" &&
    isNodeOfType(expression.arguments?.[0], "ThisExpression")
      ? stripParenExpression(expression.callee.object as EsTreeNode)
      : null;
  const methodReference = boundTarget ?? expression;
  const memberName =
    isNodeOfType(methodReference, "MemberExpression") &&
    isNodeOfType(methodReference.object, "ThisExpression")
      ? getStaticPropertyName(methodReference)
      : null;
  return memberName ? classMemberFunction(classBody, memberName) : null;
};

const timeoutCallbackMutatesComponent = (
  callback: EsTreeNode,
  classBody: EsTreeNode | null,
): boolean => {
  const resolvedCallback = resolveTimeoutCallbackFunction(callback, classBody);
  if (!isFunctionLike(resolvedCallback)) return false;
  const body = resolvedCallback.body;
  if (!body) return false;
  let mutates = false;
  walkSynchronousCallbackFlow(body, (node) => {
    if (mutates) return;
    if (getBareCalleeName(node) === "runInAction") {
      mutates = true;
      return;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "ThisExpression")
    ) {
      // `this.focusInput()` — resolve the instance method; a ref/DOM nudge
      // that never calls setState/runInAction mutates nothing when it
      // fires after unmount.
      const memberName = getStaticPropertyName(node.callee);
      const memberFunction = memberName ? classMemberFunction(classBody, memberName) : null;
      if (memberFunction && !functionSetsComponentState(memberFunction, classBody)) return;
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
const collectMountLocalReceiverNames = (mountBody: EsTreeNode): Set<string> => {
  const declaredNames = new Set<string>();
  const escapedNames = new Set<string>();
  walkSynchronousCallbackFlow(mountBody, (node) => {
    if (isNodeOfType(node, "VariableDeclarator")) {
      const initializer = node.init ? stripParenExpression(node.init as EsTreeNode) : null;
      if (
        initializer &&
        (isNodeOfType(initializer, "NewExpression") ||
          isNodeOfType(initializer, "ObjectExpression") ||
          isNodeOfType(initializer, "ArrayExpression") ||
          (isNodeOfType(initializer, "CallExpression") &&
            isNodeOfType(initializer.callee, "Identifier") &&
            MOUNT_LOCAL_RESOURCE_FACTORY_NAMES.has(initializer.callee.name)))
      ) {
        collectPatternNames(node.id as EsTreeNode, declaredNames);
      }
    }
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      isNodeOfType(node.left, "MemberExpression") &&
      isNodeOfType(node.right, "Identifier")
    ) {
      escapedNames.add(node.right.name);
    }
  });
  for (const escapedName of escapedNames) declaredNames.delete(escapedName);
  return declaredNames;
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
  scopes: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiverKey = serializeListenerIdentityPart(callee.object, scopes);
  const eventKey = serializeEventKey(call.arguments?.[0], scopes);
  const handlerKey = call.arguments?.[1]
    ? serializeListenerIdentityPart(call.arguments[1] as EsTreeNode, scopes)
    : null;
  if (!receiverKey || !eventKey || !handlerKey) return null;
  const options = call.arguments?.[2] as EsTreeNode | undefined;
  let captureKey = "false";
  if (options) {
    const unwrappedOptions = stripParenExpression(options);
    if (isNodeOfType(unwrappedOptions, "Literal") && typeof unwrappedOptions.value === "boolean") {
      captureKey = String(unwrappedOptions.value);
    } else {
      const optionsObject = resolveStableOptionsObject(options, ["capture"], scopes);
      const opaqueOptionsKey = opaqueCaptureOptionsKey(options, scopes);
      if (!optionsObject)
        return opaqueOptionsKey
          ? `${receiverKey}|${eventKey}|${handlerKey}|${opaqueOptionsKey}`
          : null;
      if (
        optionsObject.properties.some(
          (property) =>
            !isNodeOfType(property, "Property") ||
            getStaticPropertyKeyName(property, { allowComputedString: true }) === null,
        )
      ) {
        return opaqueOptionsKey
          ? `${receiverKey}|${eventKey}|${handlerKey}|${opaqueOptionsKey}`
          : null;
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
  return `${receiverKey}|${eventKey}|${handlerKey}|${captureKey}`;
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
    const identityKey = listenerIdentityKey(node, scopes);
    if (identityKey) removedListeners.set(identityKey, node.range[0]);
  });
  return removedListeners;
};

const isMountHazard = (
  node: EsTreeNode,
  localReceiverNames: Set<string>,
  removedListeners: Map<string, number>,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  const methodName = isNodeOfType(callee, "MemberExpression")
    ? getStaticPropertyName(callee)
    : null;
  if (
    methodName &&
    LISTENER_REGISTRATION_METHODS.has(methodName) &&
    isNodeOfType(node.callee, "MemberExpression")
  ) {
    const callArguments = node.arguments ?? [];
    const isFunctionFactoryOnce = methodName === "once" && callArguments.length < 2;
    let receiverBase: EsTreeNode = node.callee.object as EsTreeNode;
    let receiverIsRefOwnedNode = false;
    // Descend member chains AND fluent call chains (d3's
    // `select(this.svgRef.current).selectAll(...).on(...)`): a ref-owned
    // node anywhere in the chain (as receiver or call argument) means the
    // listeners die with the component's own DOM.
    while (
      isNodeOfType(receiverBase, "MemberExpression") ||
      isNodeOfType(receiverBase, "CallExpression")
    ) {
      if (isNodeOfType(receiverBase, "CallExpression")) {
        for (const argument of receiverBase.arguments ?? []) {
          let argumentCursor: EsTreeNode = argument as EsTreeNode;
          while (isNodeOfType(argumentCursor, "MemberExpression")) {
            if (
              !argumentCursor.computed &&
              isNodeOfType(argumentCursor.property, "Identifier") &&
              argumentCursor.property.name === "current"
            ) {
              receiverIsRefOwnedNode = true;
            }
            argumentCursor = argumentCursor.object as EsTreeNode;
          }
        }
        receiverBase = receiverBase.callee as EsTreeNode;
        continue;
      }
      if (
        !receiverBase.computed &&
        isNodeOfType(receiverBase.property, "Identifier") &&
        receiverBase.property.name === "current"
      ) {
        receiverIsRefOwnedNode = true;
      }
      receiverBase = receiverBase.object;
    }
    const isLocalReceiver =
      isNodeOfType(receiverBase, "Identifier") && localReceiverNames.has(receiverBase.name);
    const listenerKey =
      methodName === "addEventListener" ? listenerIdentityKey(node, scopes) : null;
    const removalPosition = listenerKey ? removedListeners.get(listenerKey) : undefined;
    const isSynchronouslyRemoved = removalPosition !== undefined && removalPosition > node.range[0];
    const isSelfRemovingListener =
      (methodName === "addEventListener" && isOneShotListenerOptions(callArguments[2], scopes)) ||
      isSynchronouslyRemoved;
    // A listener on a ref-owned DOM node (`this.containerRef.current`) dies
    // with the node when the component unmounts, so it needs no teardown.
    return (
      !isFunctionFactoryOnce &&
      !isLocalReceiver &&
      !isSelfRemovingListener &&
      !receiverIsRefOwnedNode
    );
  }

  const timerCalleeName = getTimerCalleeName(node);
  if (timerCalleeName === "setInterval") return true;
  if (timerCalleeName === "setTimeout" && node.arguments?.[0]) {
    return timeoutCallbackMutatesComponent(node.arguments[0], classBody);
  }
  return false;
};

const getMemberFunctionBody = (member: EsTreeNode): EsTreeNode | null => {
  const isRelevantMember =
    isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition");
  return isRelevantMember && isFunctionLike(member.value) ? (member.value.body ?? null) : null;
};

// MobX auto-manages teardown when `disposeOnUnmount` is used anywhere in the
// class, so the missing `componentWillUnmount` is not a leak.
const classUsesDisposeOnUnmount = (classNode: EsTreeNode): boolean => {
  let found = false;
  walkAst(classNode, (child: EsTreeNode) => {
    if (found || !isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      getImportedNameFromModule(callee, callee.name, "mobx-react") === "disposeOnUnmount"
    ) {
      const target = child.arguments?.[0];
      if (!target || !isNodeOfType(stripParenExpression(target), "ThisExpression")) return;
      found = true;
      return false;
    }
  });
  return found;
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
      const hasComponentWillUnmount = members.some(
        (member) => getClassMemberName(member) === "componentWillUnmount",
      );
      if (hasComponentWillUnmount) return;
      if (classUsesDisposeOnUnmount(classNode)) return;

      for (const member of members) {
        const memberName = getClassMemberName(member);
        if (memberName !== "constructor" && memberName !== "componentDidMount") continue;
        const body = getMemberFunctionBody(member);
        if (!body) continue;

        const localReceiverNames = collectMountLocalReceiverNames(body);
        const removedListeners = collectSynchronouslyRemovedListeners(body, context.scopes);
        let hazardNode: EsTreeNode | null = null;
        walkSynchronousCallbackFlow(body, (candidate) => {
          if (hazardNode) return;
          if (
            isMountHazard(candidate, localReceiverNames, removedListeners, node, context.scopes)
          ) {
            hazardNode = candidate;
          }
        });
        if (hazardNode) {
          context.report({ node: hazardNode, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
