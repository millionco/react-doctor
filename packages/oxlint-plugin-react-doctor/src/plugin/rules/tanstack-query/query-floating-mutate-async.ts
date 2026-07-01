import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Callback hosts that discard their callback's return value, so a concise
// `() => x.mutateAsync()` body there is a fire-and-forget floating call —
// exactly where an unhandled rejection is most acute (effects + timers).
const FLOATING_CALLBACK_HOST_NAMES = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
]);

const isMutateAsyncCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "mutateAsync";

// A concise `() => x.mutateAsync()` returns the promise to its caller, so
// it's only floating when that return value is thrown away: a bare
// statement, a JSX event handler, or a discarding scheduler callback
// (useEffect/setTimeout/...). Passing the arrow into `Promise.all(items.map(...))`
// or returning it keeps the rejection reachable, so those stay quiet.
const isDiscardedArrowReturn = (arrow: EsTreeNode): boolean => {
  const parent = arrow.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
  if (isNodeOfType(parent, "CallExpression")) {
    const isArgument = parent.arguments?.some((argument) => argument === arrow) ?? false;
    if (!isArgument) return false;
    const hostName = getCalleeName(parent);
    return hostName !== null && FLOATING_CALLBACK_HOST_NAMES.has(hostName);
  }
  return false;
};

// True when the mutateAsync call's promise is discarded: a bare
// ExpressionStatement, or the concise body of a discarded-return arrow.
// Any await/return/void wrapper, `.then`/`.catch` chain, assignment, or
// `Promise.all([...])` argument reparents the call away from these shapes.
const isFloatingMutateAsync = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === node) {
    return isDiscardedArrowReturn(parent);
  }
  return false;
};

export const queryFloatingMutateAsync = defineRule({
  id: "query-floating-mutate-async",
  title: "Floating mutateAsync rejection",
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Await, return, or `.catch()` the `mutateAsync()` promise so its rejection surfaces an error instead of becoming a silent unhandled rejection.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMutateAsyncCall(node)) return;
      if (!isFloatingMutateAsync(node)) return;
      context.report({
        node,
        message:
          "This `mutateAsync()` promise is never awaited or caught, so a failed mutation becomes a silent unhandled rejection — await, return, or `.catch()` it.",
      });
    },
  }),
});
