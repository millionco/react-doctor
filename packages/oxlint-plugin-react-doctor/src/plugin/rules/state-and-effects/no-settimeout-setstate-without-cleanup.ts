import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const STATE_SETTER_PATTERN = /^set[A-Z]/;
const GLOBAL_TIMER_RECEIVERS = new Set(["window", "globalThis", "global"]);

const MESSAGE =
  "This `setTimeout` fires a state setter after a delay, but its id is never captured and no `clearTimeout` cancels it, so the pending timer runs against a torn-down component after unmount. Capture the id and clear it in an effect cleanup / unmount teardown.";

const isSetTimeoutCall = (
  node: EsTreeNodeOfType<"CallExpression">
): boolean => {
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name === "setTimeout";
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    GLOBAL_TIMER_RECEIVERS.has(callee.object.name) &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name === "setTimeout";
  }
  return false;
};

// The callback runs a React state setter, so the leaked timer performs a
// post-unmount state update.
const callbackCallsStateSetter = (callback: EsTreeNode): boolean => {
  const body = (callback as { body?: EsTreeNode }).body;
  if (!body) return false;
  let found = false;
  walkAst(body, (child: EsTreeNode) => {
    if (found) return false;
    // Don't cross into a further nested function — its setters fire on a
    // different tick, not when this timer callback runs.
    if (child !== body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      STATE_SETTER_PATTERN.test(child.callee.name)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// The timer id escapes when it is stored (`const id = setTimeout`,
// `ref.current = setTimeout`, `return setTimeout`, an argument, etc.) —
// meaning something can clear it. A bare expression statement is the
// genuinely uncaptured, fire-and-forget shape.
const timerIdIsUncaptured = (
  node: EsTreeNodeOfType<"CallExpression">
): boolean => isNodeOfType(node.parent, "ExpressionStatement");

const findEnclosingComponentScope = (node: EsTreeNode): EsTreeNode | null => {
  let scope: EsTreeNode | null = null;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) scope = cursor;
    cursor = cursor.parent ?? null;
  }
  return scope;
};

const scopeContainsClearTimeout = (scope: EsTreeNode): boolean => {
  let found = false;
  walkAst(scope, (child: EsTreeNode) => {
    if (found) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (isNodeOfType(callee, "Identifier") && callee.name === "clearTimeout") {
      found = true;
      return false;
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "clearTimeout"
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// Flags a `setTimeout` inside a component/hook whose callback calls a
// state setter, whose id is never captured, and where no `clearTimeout`
// appears anywhere in the enclosing component/hook. The pending timer
// fires the setter after unmount and leaks its closure. Captured ids
// (`const id = setTimeout`, `ref.current = setTimeout`) and any
// `clearTimeout` in scope keep it quiet.
export const noSettimeoutSetstateWithoutCleanup = defineRule({
  id: "no-settimeout-setstate-without-cleanup",
  title: "setTimeout state setter never cleared",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "A `setTimeout` whose callback calls a state setter leaks the pending timer when the id is never captured and never cleared, firing the setter against a torn-down component. Store the id and `clearTimeout` it in an effect cleanup / unmount teardown.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isSetTimeoutCall(node)) return;
      const callback = node.arguments[0];
      if (!callback || !isFunctionLike(callback as EsTreeNode)) return;
      if (!callbackCallsStateSetter(callback as EsTreeNode)) return;
      if (!timerIdIsUncaptured(node)) return;

      const scope = findEnclosingComponentScope(node as EsTreeNode);
      if (!scope) return;
      if (scopeContainsClearTimeout(scope)) return;

      context.report({ node: node as EsTreeNode, message: MESSAGE });
    },
  }),
});
