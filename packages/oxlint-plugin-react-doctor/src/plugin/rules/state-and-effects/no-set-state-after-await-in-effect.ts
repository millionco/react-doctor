import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionBodyHasReturnWithValue } from "../../utils/function-body-has-return-with-value.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookBindingInScope } from "../../utils/is-hook-binding-in-scope.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This setter runs after `await`, so overlapping re-runs of the effect can resolve out of order and write stale state; gate it behind a cancellation/ignore flag or return a cleanup that cancels the work.";

const STATE_DISPATCHER_HOOKS = new Set(["useState", "useReducer"]);
const STABLE_IDENTITY_HOOK = "useRef";

// Cancellation / mounted-guard idioms. When the awaiting scope reads any of
// these we assume the developer already guards the post-await write, so we
// stay quiet — false positives are worse than the occasional missed case.
const CANCELLATION_GUARD_PATTERN =
  /^(?:is|has|did|was)?_?(?:mount|unmount|cancel|abort|ignore|stale|dispos|destroy|alive|signal|active)/i;

const getNodeStart = (node: EsTreeNode): number | null => {
  const start = (node as { start?: unknown }).start;
  return typeof start === "number" ? start : null;
};

const getNodeEnd = (node: EsTreeNode): number | null => {
  const end = (node as { end?: unknown }).end;
  return typeof end === "number" ? end : null;
};

const getDependencyArray = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  const dependencyArgument = effectCall.arguments?.[1];
  if (!dependencyArgument || !isNodeOfType(dependencyArgument, "ArrayExpression")) return null;
  return dependencyArgument;
};

// A mount-only effect (empty deps) or one whose deps are all stable-identity
// bindings (useState/useReducer dispatcher, useRef box) can never have
// overlapping re-runs, so the out-of-order stale-write hazard cannot occur.
const hasOnlyStableIdentityDependencies = (
  dependencyArray: EsTreeNodeOfType<"ArrayExpression">,
): boolean =>
  (dependencyArray.elements ?? []).every((dependencyElement) => {
    if (!isNodeOfType(dependencyElement, "Identifier")) return false;
    return (
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STATE_DISPATCHER_HOOKS,
        destructureIndex: 1,
      }) ||
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STABLE_IDENTITY_HOOK,
      })
    );
  });

const isStateDispatcherCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  return isHookBindingInScope(callExpression, {
    bindingName: callExpression.callee.name,
    hookName: STATE_DISPATCHER_HOOKS,
    destructureIndex: 1,
  });
};

const referencesCancellationGuard = (asyncFunction: EsTreeNode): boolean => {
  let found = false;
  walkAst(asyncFunction, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && CANCELLATION_GUARD_PATTERN.test(child.name)) {
      found = true;
      return false;
    }
    // A `.current` read is the ref-based mounted-guard idiom.
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === "current"
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// The awaiting async scope is a stale-write hazard when a state setter
// finishes lexically after the first suspension point (`await` or
// `for await...of`) in that same scope. Comparing the setter's END offset
// also catches `setData(await load())`, where the setter call starts before
// the await nested in its own arguments but still executes after it.
const hasPostAwaitStateSetter = (asyncFunction: EsTreeNode): boolean => {
  let earliestSuspensionStart: number | null = null;
  walkOwnFunctionScope(asyncFunction, (node) => {
    const isSuspensionPoint =
      isNodeOfType(node, "AwaitExpression") ||
      (isNodeOfType(node, "ForOfStatement") && node.await === true);
    if (!isSuspensionPoint) return;
    const start = getNodeStart(node);
    if (start === null) return;
    if (earliestSuspensionStart === null || start < earliestSuspensionStart) {
      earliestSuspensionStart = start;
    }
  });
  if (earliestSuspensionStart === null) return false;
  const firstSuspensionStart = earliestSuspensionStart;

  let hasLaterSetter = false;
  walkOwnFunctionScope(asyncFunction, (node) => {
    if (hasLaterSetter) return;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (!isStateDispatcherCall(node)) return;
    const setterEnd = getNodeEnd(node);
    if (setterEnd === null) return;
    if (setterEnd > firstSuspensionStart) hasLaterSetter = true;
  });
  return hasLaterSetter;
};

export const noSetStateAfterAwaitInEffect = defineRule({
  id: "no-set-state-after-await-in-effect",
  title: "State update after await in an effect",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "In a `useEffect` whose dependencies can change, guard any setter call that runs after an `await` behind a cancellation/ignore flag, or return a cleanup that cancels the async work.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!isFunctionLike(callback)) return;
      // Async effect callbacks are owned by `no-async-effect-callback`.
      if (callback.async) return;
      const dependencyArray = getDependencyArray(node);
      if (dependencyArray && hasOnlyStableIdentityDependencies(dependencyArray)) return;
      // A cleanup return is the documented fix; stay quiet when one exists.
      if (functionBodyHasReturnWithValue(callback)) return;

      const asyncFunctions: EsTreeNode[] = [];
      walkAst(callback, (child: EsTreeNode) => {
        if (child === callback) return;
        if (isFunctionLike(child) && child.async) asyncFunctions.push(child);
      });

      for (const asyncFunction of asyncFunctions) {
        if (referencesCancellationGuard(asyncFunction)) continue;
        if (hasPostAwaitStateSetter(asyncFunction)) {
          context.report({ node, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
