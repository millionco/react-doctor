import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isProvenEffectHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";

const OBSERVER_RELEASE_METHOD_NAMES = new Set(["disconnect", "unobserve"]);
const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);
const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "forEach",
  "map",
  "some",
]);

const isSynchronouslyInvokedCallback = (functionNode: EsTreeNode): boolean => {
  const call = functionNode.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    !call.arguments.some((argument) => argument === functionNode)
  ) {
    return false;
  }
  const callee = stripParenExpression(call.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
  );
};

interface TrackedObserver {
  construction: EsTreeNodeOfType<"NewExpression">;
  bindingIdentifier: EsTreeNode;
  didObserve: boolean;
  didRelease: boolean;
  didEscape: boolean;
  observedTargetKeys: Set<string>;
}

const recordObserverUsage = (
  identifier: EsTreeNodeOfType<"Identifier">,
  tracked: TrackedObserver,
): void => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (binding && binding.bindingIdentifier !== tracked.bindingIdentifier) return;
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const parent = referenceRoot.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.id === identifier) return;
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
    if (parent.computed) {
      tracked.didEscape = true;
      return;
    }
    const methodCall = parent.parent;
    if (!isNodeOfType(methodCall, "CallExpression") || methodCall.callee !== parent) return;
    const accessedMethodName = getStaticPropertyName(parent);
    if (accessedMethodName === "observe") {
      tracked.didObserve = true;
      const targetArgument = methodCall.arguments?.[0];
      const targetKey = targetArgument ? serializeReferenceKey(targetArgument) : null;
      if (targetKey) tracked.observedTargetKeys.add(targetKey);
      return;
    }
    if (accessedMethodName === "disconnect" && tracked.didObserve) {
      tracked.didRelease = true;
      return;
    }
    if (accessedMethodName === "unobserve" && tracked.didObserve) {
      const targetArgument = methodCall.arguments?.[0];
      const targetKey = targetArgument ? serializeReferenceKey(targetArgument) : null;
      if (targetKey && tracked.observedTargetKeys.has(targetKey)) tracked.didRelease = true;
    }
    return;
  }
  tracked.didEscape = true;
};

// One-shot observers release themselves through the callback's SECOND
// parameter — `new IntersectionObserver((entries, obs) => { ...
// obs.disconnect() })` — the spec-provided reference to the observer
// itself. A release through that alias is as real as one through the
// binding.
const callbackReleasesViaObserverParameter = (
  construction: EsTreeNodeOfType<"NewExpression">,
): boolean => {
  const observerCallback = construction.arguments?.[0]
    ? stripParenExpression(construction.arguments[0] as EsTreeNode)
    : null;
  if (
    !observerCallback ||
    (!isNodeOfType(observerCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(observerCallback, "FunctionExpression"))
  ) {
    return false;
  }
  const callbackFunction = observerCallback;
  const observerParameter = callbackFunction.params?.[1];
  if (!observerParameter || !isNodeOfType(observerParameter as EsTreeNode, "Identifier")) {
    return false;
  }
  const parameterName = (observerParameter as EsTreeNodeOfType<"Identifier">).name;
  let didRelease = false;
  walkAst(callbackFunction, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (
      child !== callbackFunction &&
      isFunctionLike(child) &&
      !isSynchronouslyInvokedCallback(child)
    ) {
      return false;
    }
    if (!isNodeOfType(child, "MemberExpression")) return;
    const receiver = stripParenExpression(child.object as EsTreeNode);
    if (!isNodeOfType(receiver, "Identifier") || receiver.name !== parameterName) return;
    if (!OBSERVER_RELEASE_METHOD_NAMES.has(getStaticPropertyName(child) ?? "")) return;
    if (!isNodeOfType(child.parent, "CallExpression") || child.parent.callee !== child) return;
    didRelease = true;
    return false;
  });
  return didRelease;
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
      if (!callback) return;

      const trackedObserversByName = new Map<string, TrackedObserver>();
      walkAst(callback, (child: EsTreeNode) => {
        if (child !== callback && isFunctionLike(child)) return false;
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
        if (!bindingName || trackedObserversByName.has(bindingName)) return;
        trackedObserversByName.set(bindingName, {
          construction: child,
          bindingIdentifier: declarator.id,
          didObserve: false,
          didRelease: callbackReleasesViaObserverParameter(child),
          didEscape: false,
          observedTargetKeys: new Set(),
        });
      });
      if (trackedObserversByName.size === 0) return;

      walkAst(callback, (child: EsTreeNode) => {
        if (child !== callback && isFunctionLike(child)) return false;
        if (!isNodeOfType(child, "Identifier")) return;
        const tracked = trackedObserversByName.get(child.name);
        if (tracked) recordObserverUsage(child, tracked);
      });

      for (const cleanupFunction of collectReturnedCleanupFunctions(callback)) {
        walkAst(cleanupFunction, (child: EsTreeNode) => {
          if (child !== cleanupFunction && isFunctionLike(child)) return false;
          if (!isNodeOfType(child, "Identifier")) return;
          const tracked = trackedObserversByName.get(child.name);
          if (tracked) recordObserverUsage(child, tracked);
        });
      }

      for (const [bindingName, tracked] of trackedObserversByName) {
        const observerCallback = tracked.construction.arguments?.[0];
        if (!observerCallback || !isFunctionLike(stripParenExpression(observerCallback))) continue;
        const callbackFunction = stripParenExpression(observerCallback);
        walkAst(callbackFunction, (child: EsTreeNode) => {
          if (child !== callbackFunction && isFunctionLike(child)) return false;
          if (isNodeOfType(child, "Identifier") && child.name === bindingName) {
            recordObserverUsage(child, tracked);
          }
        });
      }

      for (const tracked of trackedObserversByName.values()) {
        if (!tracked.didObserve || tracked.didRelease || tracked.didEscape) continue;
        context.report({
          node: tracked.construction,
          message:
            "This observer is created and started in the effect but never disconnected, so it keeps firing against detached nodes and leaks one observer per mount; return a cleanup that calls `disconnect()` or `unobserve()`.",
        });
      }
    },
  }),
});
