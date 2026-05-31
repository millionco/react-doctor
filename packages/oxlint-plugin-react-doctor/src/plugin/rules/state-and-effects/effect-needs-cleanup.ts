import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isCleanupReturningSubscribeLikeCallExpression,
  isSubscribeLikeCallExpression,
} from "./utils/is-subscribe-like-call-expression.js";
import { isCleanupFunctionLike, isCleanupReturn } from "./utils/is-cleanup-return.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface SubscribeLikeUsage {
  kind: "subscribe" | "timer";
  resourceName: string;
}

const findSubscribeLikeUsages = (callback: EsTreeNode): SubscribeLikeUsage[] => {
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

  walkAst(callback, (child: EsTreeNode) => {
    if (child === cleanupArgument && !isSubscribeLikeCallExpression(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
    ) {
      usages.push({
        kind: "timer",
        resourceName: child.callee.name,
      });
      return;
    }

    if (
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)
    ) {
      usages.push({
        kind: "subscribe",
        resourceName: child.callee.property.name,
      });
    }
  });
  return usages;
};

interface CleanupBindings {
  cleanupFunctionNames: Set<string>;
  subscriptionNames: Set<string>;
  effectScopeVariableNames: Set<string>;
}

const collectCleanupBindings = (effectCallback: EsTreeNode): CleanupBindings => {
  const bindings: CleanupBindings = {
    cleanupFunctionNames: new Set<string>(),
    subscriptionNames: new Set<string>(),
    effectScopeVariableNames: new Set<string>(),
  };
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return bindings;
  }
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) return bindings;

  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "VariableDeclaration")) return;
    for (const declarator of child.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const bindingName = declarator.id.name;
      bindings.effectScopeVariableNames.add(bindingName);
      const init = declarator.init;
      if (!init || !isNodeOfType(init, "CallExpression")) continue;
      if (isSubscribeLikeCallExpression(init)) {
        bindings.subscriptionNames.add(bindingName);
        if (isCleanupReturningSubscribeLikeCallExpression(init)) {
          bindings.cleanupFunctionNames.add(bindingName);
        }
      }
    }
  });

  walkAst(effectCallback.body, (child: EsTreeNode) => {
    if (
      child !== effectCallback.body &&
      (isNodeOfType(child, "ArrowFunctionExpression") || isNodeOfType(child, "FunctionExpression"))
    ) {
      return false;
    }
    if (
      isNodeOfType(child, "FunctionDeclaration") &&
      child.id &&
      isCleanupFunctionLike(child, bindings.cleanupFunctionNames, bindings.subscriptionNames)
    ) {
      bindings.cleanupFunctionNames.add(child.id.name);
      return false;
    }
  });

  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "VariableDeclaration")) return;
    for (const declarator of child.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      if (
        isCleanupFunctionLike(
          declarator.init,
          bindings.cleanupFunctionNames,
          bindings.subscriptionNames,
        )
      ) {
        bindings.cleanupFunctionNames.add(declarator.id.name);
      }
    }
  });

  walkAst(effectCallback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      bindings.effectScopeVariableNames.has(child.left.name) &&
      isCleanupFunctionLike(child.right, bindings.cleanupFunctionNames, bindings.subscriptionNames)
    ) {
      bindings.cleanupFunctionNames.add(child.left.name);
    }
  });

  return bindings;
};

const effectHasCleanupRelease = (callback: EsTreeNode): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return isCleanupReturningSubscribeLikeCallExpression(callback.body);
  }
  const cleanupBindings = collectCleanupBindings(callback);
  let didFindCleanupReturn = false;
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (didFindCleanupReturn) return;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (
      isCleanupReturn(
        child.argument,
        cleanupBindings.cleanupFunctionNames,
        cleanupBindings.subscriptionNames,
      )
    ) {
      didFindCleanupReturn = true;
    }
  });
  return didFindCleanupReturn;
};

export const effectNeedsCleanup = defineRule<Rule>({
  id: "effect-needs-cleanup",
  title: "Effect subscription or timer never cleaned up",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Return a cleanup function that stops the subscription or timer: `return () => target.removeEventListener(name, handler)` for listeners, `return () => clearInterval(id)` or `clearTimeout(id)` for timers, or `return unsubscribe` if the subscribe call already gave you one.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const usages = findSubscribeLikeUsages(callback);
      if (usages.length === 0) return;

      if (effectHasCleanupRelease(callback)) return;

      const firstUsage = usages[0];
      const verb = firstUsage.kind === "timer" ? "schedules" : "subscribes via";
      context.report({
        node,
        message: `\`${firstUsage.resourceName}(...)\` leaks memory because useEffect ${verb} it but never cleans it up.`,
      });
    },
  }),
});
