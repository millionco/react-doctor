import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isProvenEffectHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";

const OBSERVER_RELEASE_METHOD_NAMES = new Set(["disconnect", "unobserve"]);
const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);

interface TrackedObserver {
  construction: EsTreeNodeOfType<"NewExpression">;
  bindingIdentifier: EsTreeNode;
  didObserve: boolean;
  didObserveUnknownTarget: boolean;
  didReleaseAll: boolean;
  didReleaseViaCallbackParameter: boolean;
  didEscape: boolean;
  observedTargetKeys: Set<string>;
}

const recordObserverUsage = (
  identifier: EsTreeNodeOfType<"Identifier">,
  tracked: TrackedObserver,
  context: RuleContext,
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
      const targetArgument = methodCall.arguments?.[0];
      const targetKey = targetArgument
        ? serializeReferenceKey({ node: targetArgument, scopes: context.scopes })
        : null;
      if (targetKey) tracked.observedTargetKeys.add(targetKey);
      else tracked.didObserveUnknownTarget = true;
      return;
    }
    if (accessedMethodName === "disconnect" && tracked.didObserve) {
      tracked.didReleaseAll = true;
      tracked.didObserveUnknownTarget = false;
      tracked.observedTargetKeys.clear();
      return;
    }
    if (accessedMethodName === "unobserve" && tracked.didObserve) {
      const targetArgument = methodCall.arguments?.[0];
      const targetKey = targetArgument
        ? serializeReferenceKey({ node: targetArgument, scopes: context.scopes })
        : null;
      if (targetKey && tracked.observedTargetKeys.has(targetKey)) {
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
    const boundMethod = isNodeOfType(bindCallee, "MemberExpression")
      ? stripParenExpression(bindCallee.object)
      : null;
    if (
      isNodeOfType(bindCallee, "MemberExpression") &&
      getStaticPropertyName(bindCallee) === "bind" &&
      isNodeOfType(boundMethod, "MemberExpression") &&
      isTrackedObserverReference(boundMethod.object, tracked.bindingIdentifier)
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
const callbackReleasesViaObserverParameter = (
  construction: EsTreeNodeOfType<"NewExpression">,
  scopes: RuleContext["scopes"],
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
  const parameterBindingIdentifier = scopes.symbolFor(
    observerParameter as EsTreeNode,
  )?.bindingIdentifier;
  if (!parameterBindingIdentifier) return false;
  let didRelease = false;
  walkSynchronousCallbackFlow(callbackFunction, (child: EsTreeNode) => {
    if (didRelease) return;
    if (!isNodeOfType(child, "MemberExpression")) return;
    const receiver = stripParenExpression(child.object as EsTreeNode);
    if (
      !isNodeOfType(receiver, "Identifier") ||
      scopes.symbolFor(receiver)?.bindingIdentifier !== parameterBindingIdentifier
    ) {
      return;
    }
    if (!OBSERVER_RELEASE_METHOD_NAMES.has(getStaticPropertyName(child) ?? "")) return;
    if (!isNodeOfType(child.parent, "CallExpression") || child.parent.callee !== child) return;
    didRelease = true;
  });
  return didRelease;
};

const isTrackedObserverReference = (
  expression: EsTreeNode,
  bindingIdentifier: EsTreeNode,
): boolean => {
  const reference = stripParenExpression(expression);
  return (
    isNodeOfType(reference, "Identifier") &&
    findVariableInitializer(reference, reference.name)?.bindingIdentifier === bindingIdentifier
  );
};

const isBoundObserverDisconnect = (
  returnExpression: EsTreeNode,
  bindingIdentifier: EsTreeNode,
  visitedExpressions = new Set<EsTreeNode>(),
): boolean => {
  const expression = stripParenExpression(returnExpression);
  if (visitedExpressions.has(expression)) return false;
  visitedExpressions.add(expression);
  if (isNodeOfType(expression, "Identifier")) {
    const initializer = findVariableInitializer(expression, expression.name)?.initializer;
    return initializer
      ? isBoundObserverDisconnect(initializer, bindingIdentifier, visitedExpressions)
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
    isTrackedObserverReference(boundMethod.object, bindingIdentifier) &&
    isTrackedObserverReference(boundReceiver, bindingIdentifier),
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
        trackedObserversByBinding.set(declarator.id, {
          construction: child,
          bindingIdentifier: declarator.id,
          didObserve: false,
          didObserveUnknownTarget: false,
          didReleaseAll: false,
          didReleaseViaCallbackParameter: callbackReleasesViaObserverParameter(
            child,
            context.scopes,
          ),
          didEscape: false,
          observedTargetKeys: new Set(),
        });
      });
      if (trackedObserversByBinding.size === 0) return;

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

      for (const tracked of trackedObserversByBinding.values()) {
        const bindingName = isNodeOfType(tracked.bindingIdentifier, "Identifier")
          ? tracked.bindingIdentifier.name
          : null;
        if (!bindingName) continue;
        const observerCallback = tracked.construction.arguments?.[0];
        if (!observerCallback || !isFunctionLike(stripParenExpression(observerCallback))) continue;
        const callbackFunction = stripParenExpression(observerCallback);
        walkSynchronousCallbackFlow(callbackFunction, (child: EsTreeNode) => {
          if (isNodeOfType(child, "Identifier") && child.name === bindingName) {
            recordObserverUsage(child, tracked, context);
          }
        });
      }

      const returnedExpressions = isNodeOfType(callback.body, "BlockStatement")
        ? collectFunctionReturnStatements(callback).flatMap((returnStatement) =>
            returnStatement.argument ? [returnStatement.argument] : [],
          )
        : [callback.body];
      for (const tracked of trackedObserversByBinding.values()) {
        if (
          returnedExpressions.some((returnExpression) =>
            isBoundObserverDisconnect(returnExpression, tracked.bindingIdentifier),
          )
        ) {
          tracked.didReleaseAll = true;
          tracked.didObserveUnknownTarget = false;
          tracked.observedTargetKeys.clear();
        }
        const didReleaseEveryActiveTarget =
          !tracked.didObserveUnknownTarget && tracked.observedTargetKeys.size === 0;
        if (
          !tracked.didObserve ||
          tracked.didReleaseAll ||
          tracked.didReleaseViaCallbackParameter ||
          didReleaseEveryActiveTarget ||
          tracked.didEscape
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
