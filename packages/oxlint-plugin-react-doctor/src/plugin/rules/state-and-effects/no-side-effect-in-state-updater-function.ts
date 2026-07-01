import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const CONSUMER_CALLBACK_NAME_PATTERN = /^on[A-Z]/;
const CALLBACK_NAME_PATTERN = /callback/i;
// Analytics / logging / persistence verbs that denote a fire-and-forget
// external side effect, not a pure state transform.
const SIDE_EFFECT_VERB_PATTERN =
  /^(?:track|log|capture|analytics|persist|emit|notify)/i;

// Timer setters syntactically match `/^set[A-Z]/` but are NOT React
// state setters; excluding them stops a nested consumer callback inside a
// `setInterval(() => ...)` lambda from being misattributed to the timer.
const TIMER_SETTER_NAMES = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
]);

// Pure array/set/map builders are exactly what a legitimate immutable
// updater is made of; never treat them as an impure side effect.
const PURE_BUILTIN_METHOD_NAMES = new Set([
  "map",
  "filter",
  "find",
  "has",
  "delete",
  "add",
  "some",
  "every",
  "reduce",
  "slice",
  "concat",
  "includes",
]);

const isReactStateUpdaterCall = (
  node: EsTreeNodeOfType<"CallExpression">
): boolean => {
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const name = node.callee.name;
  if (TIMER_SETTER_NAMES.has(name)) return false;
  return name === "dispatch" || isSetterIdentifier(name);
};

// An impure effectful call: an optional consumer callback `x?.(...)`, an
// `on*` / `*Callback` / `callback` named call, or an analytics/persistence
// verb. Never a React setter (a nested setter is a different concern) and
// never a pure array/set/map builtin.
const isImpureSideEffectCall = (
  call: EsTreeNodeOfType<"CallExpression">
): boolean => {
  const calleeName = getCalleeName(call);
  if (calleeName) {
    if (PURE_BUILTIN_METHOD_NAMES.has(calleeName)) return false;
    if (isSetterIdentifier(calleeName)) return false;
  }
  if (call.optional) return true;
  if (!calleeName) return false;
  return (
    CONSUMER_CALLBACK_NAME_PATTERN.test(calleeName) ||
    CALLBACK_NAME_PATTERN.test(calleeName) ||
    calleeName.endsWith("Callback") ||
    SIDE_EFFECT_VERB_PATTERN.test(calleeName)
  );
};

const isImmediateStateUpdaterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") && isReactStateUpdaterCall(node);

// A block-body function whose body reaches a `return <value>`: the shape
// where an interleaved statement side effect can hide before the pure
// next-state is returned. Nested functions are pruned so only this
// function's own returns count.
const blockBodyReturnsValue = (functionNode: EsTreeNode): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return false;
  }
  let returnsValue = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (isNodeOfType(child, "ReturnStatement") && child.argument)
      returnsValue = true;
  });
  return returnsValue;
};

const findNearestEnclosingFunction = (
  node: EsTreeNode,
  boundary: EsTreeNode
): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    if (cursor === boundary) return null;
    cursor = cursor.parent;
  }
  return null;
};

const unwrapStatementCall = (
  expression: EsTreeNode
): EsTreeNodeOfType<"CallExpression"> | null => {
  let current = expression;
  if (isNodeOfType(current, "AwaitExpression") && current.argument) {
    current = current.argument;
  }
  current = stripParenExpression(current);
  return isNodeOfType(current, "CallExpression") ? current : null;
};

export const noSideEffectInStateUpdaterFunction = defineRule({
  id: "no-side-effect-in-state-updater-function",
  title: "Side effect inside a state updater function",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "React may run a state updater more than once (StrictMode double-invoke, concurrent replay), so a consumer callback, analytics, or persistence call inside it fires an unpredictable number of times. Compute the next state purely, then run the side effect outside the setter so it fires exactly once.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactStateUpdaterCall(node)) return;
      const updater = node.arguments?.[0];
      if (!updater || !isFunctionLike(updater)) return;

      // Collect value-returning block-body functions inside the updater
      // (the updater itself or a nested transform like `.map(...)`),
      // pruning nested state-updater calls so their bodies are attributed
      // to their own setter, not this one.
      const valueReturningFunctions = new Set<EsTreeNode>();
      walkAst(updater, (child: EsTreeNode) => {
        if (child !== updater && isImmediateStateUpdaterCall(child))
          return false;
        if (isFunctionLike(child) && blockBodyReturnsValue(child)) {
          valueReturningFunctions.add(child);
        }
      });
      if (valueReturningFunctions.size === 0) return;

      walkAst(updater, (child: EsTreeNode) => {
        if (child !== updater && isImmediateStateUpdaterCall(child))
          return false;
        if (!isNodeOfType(child, "ExpressionStatement")) return;
        const call = unwrapStatementCall(child.expression);
        if (!call || !isImpureSideEffectCall(call)) return;
        const owner = findNearestEnclosingFunction(
          child,
          updater.parent ?? updater
        );
        if (!owner || !valueReturningFunctions.has(owner)) return;
        context.report({
          node: call,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once (StrictMode double-invoke, concurrent replay), so it fires an unpredictable number of times. Move it outside the setter after computing the next state.",
        });
      });
    },
  }),
});
