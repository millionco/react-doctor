import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
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
const SIDE_EFFECT_VERB_PATTERN = /^(?:track|log|capture|analytics|persist|emit|notify)/i;

// Timer setters syntactically match `/^set[A-Z]/` but are NOT React
// state setters; excluding them stops a nested consumer callback inside a
// `setInterval(() => ...)` lambda from being misattributed to the timer.
const TIMER_SETTER_NAMES = new Set(["setTimeout", "setInterval", "setImmediate"]);

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

// Only `set*`-named identifiers count: `dispatch(fn)` is never a React
// useReducer updater (dispatch takes action objects), so a function
// argument to `dispatch` is a redux-thunk whose whole purpose is to run
// side effects exactly once.
const isReactStateUpdaterCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const name = node.callee.name;
  if (TIMER_SETTER_NAMES.has(name)) return false;
  if (!isSetterIdentifier(name)) return false;
  // A resolvable same-file binding that is NOT the index-1 slot of a
  // useState/useReducer destructure is not a replayable React updater:
  // react-router's setSearchParams (eager, exactly-once), vanilla
  // external-store setters, zustand-style eager setters. Unresolvable
  // names (prop setters) keep the conservative React assumption.
  const binding = findVariableInitializer(node.callee, name);
  if (!binding) return true;
  const declarator = binding.bindingIdentifier.parent;
  let arrayPattern: EsTreeNode | null | undefined = binding.bindingIdentifier.parent;
  while (arrayPattern && !isNodeOfType(arrayPattern, "VariableDeclarator")) {
    arrayPattern = arrayPattern.parent;
  }
  if (
    arrayPattern &&
    isNodeOfType(arrayPattern, "VariableDeclarator") &&
    isNodeOfType(arrayPattern.id, "ArrayPattern") &&
    isNodeOfType(arrayPattern.init, "CallExpression") &&
    isNodeOfType(arrayPattern.init.callee, "Identifier") &&
    (arrayPattern.init.callee.name === "useState" ||
      arrayPattern.init.callee.name === "useReducer") &&
    (arrayPattern.id.elements ?? [])[1] === binding.bindingIdentifier
  ) {
    return true;
  }
  // Direct function bindings (`const setTheme = (mode) => ...`) and
  // destructures from other hooks are eager setters.
  void declarator;
  return false;
};

// An impure effectful call: an optional consumer callback `x?.(...)`, an
// `on*` / `*Callback` / `callback` named call, or an analytics/persistence
// verb. Never a React setter (a nested setter is a different concern) and
// never a pure array/set/map builtin.
const isImpureSideEffectCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  updaterLocalNames: Set<string>,
): boolean => {
  const calleeName = getCalleeName(call);
  if (calleeName) {
    if (PURE_BUILTIN_METHOD_NAMES.has(calleeName)) return false;
    if (isSetterIdentifier(calleeName)) return false;
  }
  if (call.optional) return true;
  if (!calleeName) return false;
  if (CONSUMER_CALLBACK_NAME_PATTERN.test(calleeName)) return true;
  // console.log/warn/... is diagnostics, not the analytics/persistence
  // hazard the verb pattern names.
  if (
    isNodeOfType(call.callee, "MemberExpression") &&
    isNodeOfType(call.callee.object, "Identifier") &&
    call.callee.object.name === "console"
  ) {
    return false;
  }
  const matchesVerbHeuristic =
    CALLBACK_NAME_PATTERN.test(calleeName) ||
    calleeName.endsWith("Callback") ||
    SIDE_EFFECT_VERB_PATTERN.test(calleeName);
  if (!matchesVerbHeuristic) return false;
  // `capturePiece(next, move.to)` / `logMove(next, move)` — a verb-named
  // helper handed the updater's own local draft is clone-then-mutate, not
  // an external side effect.
  const touchesUpdaterLocal = (call.arguments ?? []).some((argument) => {
    let cursor: EsTreeNode = stripParenExpression(argument as EsTreeNode);
    while (isNodeOfType(cursor, "MemberExpression")) cursor = cursor.object as EsTreeNode;
    return isNodeOfType(cursor, "Identifier") && updaterLocalNames.has(cursor.name);
  });
  return !touchesUpdaterLocal;
};

const isImmediateStateUpdaterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") && isReactStateUpdaterCall(node);

// A block-body function whose body reaches a `return <value>`: the shape
// where an interleaved statement side effect can hide before the pure
// next-state is returned. Nested functions are pruned so only this
// function's own returns count.
const blockBodyReturnsValue = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement")) {
    return false;
  }
  let returnsValue = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (isNodeOfType(child, "ReturnStatement") && child.argument) returnsValue = true;
  });
  return returnsValue;
};

const findNearestEnclosingFunction = (
  node: EsTreeNode,
  boundary: EsTreeNode,
): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    if (cursor === boundary) return null;
    cursor = cursor.parent;
  }
  return null;
};

// Iteration methods that INVOKE their function argument synchronously.
// Storage (`next.set(k, fn)`, `next.push(fn)`), factories
// (`createToast(id, fn)`), and wrapper HOFs (`debounce(fn, 300)`) only
// CARRY the function — it runs later on user interaction, never during a
// replay.
const SYNCHRONOUS_ITERATION_METHOD_NAMES = new Set([
  "map",
  "filter",
  "forEach",
  "flatMap",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "sort",
  "toSorted",
]);

// A nested function executes during the updater only when it is handed
// to a synchronous iteration method (`prev.map(fn)`) or is an IIFE; a
// function value merely constructed and stored in the next state (a toast
// `dismiss` handler, a column sorter) runs later on user interaction,
// never during a replay.
const isDirectCallParticipant = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (parent.callee === functionNode) return true;
  if (parent.arguments?.some((argumentNode) => argumentNode === functionNode) !== true) {
    return false;
  }
  const callee = parent.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    SYNCHRONOUS_ITERATION_METHOD_NAMES.has(callee.property.name)
  );
};

// Collects the statement's effectful calls, peeling awaits, TS wrappers,
// and guard shapes — `cond && onChange(next);` is the same side effect as
// `if (cond) onChange(next);`.
const collectStatementCalls = (
  expression: EsTreeNode,
  calls: EsTreeNodeOfType<"CallExpression">[],
): void => {
  const current = stripParenExpression(expression);
  if (isNodeOfType(current, "AwaitExpression") && current.argument) {
    collectStatementCalls(current.argument, calls);
    return;
  }
  if (isNodeOfType(current, "LogicalExpression")) {
    collectStatementCalls(current.left, calls);
    collectStatementCalls(current.right, calls);
    return;
  }
  if (isNodeOfType(current, "ConditionalExpression")) {
    collectStatementCalls(current.consequent, calls);
    collectStatementCalls(current.alternate, calls);
    return;
  }
  if (isNodeOfType(current, "SequenceExpression")) {
    for (const innerExpression of current.expressions ?? []) {
      collectStatementCalls(innerExpression, calls);
    }
    return;
  }
  if (isNodeOfType(current, "CallExpression")) calls.push(current);
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

      const walkBoundary = updater.parent ?? updater;

      const updaterLocalNames = new Set<string>();
      walkAst(updater, (child: EsTreeNode) => {
        if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
          updaterLocalNames.add(child.id.name);
        }
      });

      // Collect the functions that run synchronously during the updater —
      // the updater itself plus nested functions handed directly to a call
      // (`.map(...)`, an IIFE), transitively. Functions merely stored in
      // the next state are deferred and excluded. Nested state-updater
      // calls are pruned so their bodies are attributed to their own
      // setter, not this one.
      const executedDuringUpdater = new Set<EsTreeNode>();
      walkAst(updater, (child: EsTreeNode) => {
        if (child !== updater && isImmediateStateUpdaterCall(child)) return false;
        if (!isFunctionLike(child)) return;
        if (child === updater) {
          executedDuringUpdater.add(child);
          return;
        }
        if (!isDirectCallParticipant(child)) return;
        const enclosingFunction = findNearestEnclosingFunction(child, walkBoundary);
        if (enclosingFunction && executedDuringUpdater.has(enclosingFunction)) {
          executedDuringUpdater.add(child);
        }
      });

      // Only the "interleaved statement before a pure return" shape is
      // reportable, so some executed function must reach `return <value>`.
      const valueReturningFunctions = new Set(
        [...executedDuringUpdater].filter(blockBodyReturnsValue),
      );
      if (valueReturningFunctions.size === 0) return;

      const hasValueReturningExecutedContext = (owner: EsTreeNode): boolean => {
        let cursor: EsTreeNode | null = owner;
        while (cursor && executedDuringUpdater.has(cursor)) {
          if (valueReturningFunctions.has(cursor)) return true;
          if (cursor === updater) break;
          cursor = findNearestEnclosingFunction(cursor, walkBoundary);
        }
        return false;
      };

      walkAst(updater, (child: EsTreeNode) => {
        if (child !== updater && isImmediateStateUpdaterCall(child)) return false;
        if (!isNodeOfType(child, "ExpressionStatement")) return;
        const statementCalls: EsTreeNodeOfType<"CallExpression">[] = [];
        collectStatementCalls(child.expression, statementCalls);
        const owner = findNearestEnclosingFunction(child, walkBoundary);
        if (!owner || !executedDuringUpdater.has(owner)) return;
        if (!hasValueReturningExecutedContext(owner)) return;
        for (const call of statementCalls) {
          if (!isImpureSideEffectCall(call, updaterLocalNames)) continue;
          context.report({
            node: call,
            message:
              "This side-effecting call runs inside a state updater, which React may invoke more than once (StrictMode double-invoke, concurrent replay), so it fires an unpredictable number of times. Move it outside the setter after computing the next state.",
          });
        }
      });
    },
  }),
});
