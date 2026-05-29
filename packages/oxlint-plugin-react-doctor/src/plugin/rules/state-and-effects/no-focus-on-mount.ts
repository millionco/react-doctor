import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const unwrapOptionalChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? node.expression : node;

const effectHasEmptyDependencyList = (effectCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const dependencyList = effectCall.arguments[1];
  return (
    Boolean(dependencyList) &&
    isNodeOfType(dependencyList, "ArrayExpression") &&
    dependencyList.elements.length === 0
  );
};

const isElementFocusCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = unwrapOptionalChainExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return callee.property.name === "focus";
};

// Climb past the parenthesized / TS / optional-chain wrappers that sit
// between a function and the call that invokes it, so the function's
// syntactic position is compared against the real enclosing call. Every
// such wrapper exposes its single inner node as `.expression`, so an
// identity check on that field walks the chain without enumerating types.
const ascendThroughExpressionWrappers = (node: EsTreeNode): EsTreeNode => {
  let wrapped = node;
  let parent = wrapped.parent;
  while (parent && "expression" in parent && parent.expression === wrapped) {
    wrapped = parent;
    parent = wrapped.parent;
  }
  return wrapped;
};

// A nested function inside the effect body only runs as a direct
// consequence of mounting when it is invoked immediately (an IIFE) or
// handed to a timer/scheduler that fires shortly after mount. Functions
// registered as event listeners, stored as handlers, or returned as the
// effect's cleanup run on later user interaction / unmount, so a focus call
// inside them is intentional and must not be treated as focus-on-mount.
const nestedFunctionRunsOnMount = (nestedFunction: EsTreeNode): boolean => {
  const functionInExpressionPosition = ascendThroughExpressionWrappers(nestedFunction);
  const enclosingCall = functionInExpressionPosition.parent;
  if (!enclosingCall || !isNodeOfType(enclosingCall, "CallExpression")) return false;
  if (enclosingCall.callee === functionInExpressionPosition) return true;
  const isScheduledCallback = enclosingCall.arguments.some(
    (argument) => argument === functionInExpressionPosition,
  );
  if (!isScheduledCallback) return false;
  const scheduledCalleeName = getCalleeName(enclosingCall);
  return (
    scheduledCalleeName !== null && TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(scheduledCalleeName)
  );
};

const effectFocusesDuringMount = (effectCallback: EsTreeNode): boolean => {
  let focusesDuringMount = false;
  walkAst(effectCallback, (node: EsTreeNode) => {
    if (focusesDuringMount) return false;
    if (isElementFocusCall(node)) {
      focusesDuringMount = true;
      return false;
    }
    if (node !== effectCallback && isFunctionLike(node) && !nestedFunctionRunsOnMount(node)) {
      return false;
    }
  });
  return focusesDuringMount;
};

export const noFocusOnMount = defineRule<Rule>({
  id: "no-focus-on-mount",
  severity: "warn",
  recommendation:
    "Move the focus into the user action that opens the UI, or gate it on an explicit ready/open state instead of running it on mount.\n\n```tsx\nuseEffect(() => {\n  if (isOpen) inputRef.current?.focus();\n}, [isOpen]);\n```",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      if (!effectHasEmptyDependencyList(node)) return;
      const effectCallback = getEffectCallback(node);
      if (!effectCallback) return;
      if (!effectFocusesDuringMount(effectCallback)) return;
      context.report({
        node,
        message:
          "focus() in a mount effect can steal focus before the UI is ready - move it behind a user action or an explicit open state",
      });
    },
  }),
});
