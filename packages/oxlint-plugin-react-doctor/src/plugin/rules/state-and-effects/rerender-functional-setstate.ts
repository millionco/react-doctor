import { defineRule } from "../../utils/define-rule.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const STATE_ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%", "**"]);

// HACK: derive the state variable name from the setter name. `setCount` →
// `count`. We only flag arithmetic when one operand actually matches that
// derived name; otherwise `setCount(1 + computedValue)` would false-positive
// against any incidental Identifier on either side.
const deriveStateVariableName = (setterName: string): string | null => {
  if (!setterName.startsWith("set") || setterName.length < 4) return null;
  return setterName.charAt(3).toLowerCase() + setterName.slice(4);
};

// Callees that defer execution past the current render — setTimeout-style
// timers, Promise chains, event subscriptions, useEffect bodies. State
// captured by a closure inside one of these CAN go stale because the
// callback runs after subsequent renders. Synchronous handlers like
// `onClick={() => setX({...x, …})}` are NOT subject to stale-closure
// bugs: the arrow is recreated every render and closes over fresh `x`.
//
// NOTE: `useCallback` and `useMemo` are deliberately NOT here. A
// memoized `onClick={useCallback(() => setX({...x, …}), [x])}` still
// runs synchronously when the button is clicked; the memo identity is
// stable but the closed-over state is fresh on every dep-driven recreation.
// Treating them as deferred caused false positives on memoized sync
// handlers. The actual deferred wrappers (useEffect / useLayoutEffect /
// useInsertionEffect / setTimeout / .then(...) / addEventListener /
// debounce / throttle / …) remain in the list. `debounce`/`throttle`
// wrappers (lodash-style) run the closure after a delay, past later
// renders, so their captured state goes stale exactly like setTimeout.
const DEFERRED_EXECUTION_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "debounce",
  "throttle",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "then",
  "catch",
  "finally",
  "subscribe",
  "addEventListener",
  "addListener",
  "on",
  "once",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

const EFFECT_HOOK_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

// A mount-only effect (`useEffect(fn, [])`) runs exactly once, right after
// the first render — the captured state is still current when the closure
// executes, so it cannot go stale. A setTimeout/subscription nested INSIDE
// such an effect is still deferred (the walk hits that boundary first).
const isMountOnlyEffectCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  calleeName: string,
): boolean => {
  if (!EFFECT_HOOK_CALLEE_NAMES.has(calleeName)) return false;
  const dependenciesArgument = callNode.arguments?.[1];
  return (
    isNodeOfType(dependenciesArgument, "ArrayExpression") &&
    (dependenciesArgument.elements ?? []).length === 0
  );
};

// True if the enclosing function-like ancestor is an argument to a
// deferred-execution call. Walks outward stopping at the first
// function/arrow boundary; if that boundary's parent is a CallExpression
// whose callee resolves to a deferred name, we're inside a deferred
// callback.
const isInsideDeferredCallback = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (!parent) return false;
    const isFunctionLike =
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "FunctionDeclaration");
    if (isFunctionLike && isNodeOfType(parent, "CallExpression")) {
      const callee = parent.callee;
      let calleeName: string | null = null;
      if (isNodeOfType(callee, "Identifier")) {
        calleeName = callee.name;
      } else if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier")
      ) {
        calleeName = callee.property.name;
      }
      if (
        calleeName &&
        DEFERRED_EXECUTION_CALLEE_NAMES.has(calleeName) &&
        !isMountOnlyEffectCall(parent, calleeName)
      ) {
        return true;
      }
      // Keep walking — we might be inside a nested fn whose own enclosing
      // call IS deferred.
    }
    current = parent;
  }
  return false;
};

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "FunctionDeclaration");

// A single synchronous `setX(x - 1)` per handler invocation cannot lose its
// own update — React renders between discrete events, so the next call reads
// fresh state. The sync lost-update hazard needs the same stale value feeding
// TWO updates before a render, whose static signal is a second call to the
// same setter reachable in the same enclosing function.
const hasMultipleSetterCallsInEnclosingFunction = (
  setterCallNode: EsTreeNodeOfType<"CallExpression">,
  setterName: string,
): boolean => {
  let enclosingFunction: EsTreeNode | null | undefined = setterCallNode.parent;
  while (enclosingFunction && !isFunctionLikeNode(enclosingFunction)) {
    enclosingFunction = enclosingFunction.parent;
  }
  if (!enclosingFunction) return false;

  let setterCallCount = 0;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName
    ) {
      setterCallCount += 1;
    }
  });
  return setterCallCount >= 2;
};

export const rerenderFunctionalSetstate = defineRule({
  id: "rerender-functional-setstate",
  title: "setState reads a stale value",
  severity: "warn",
  tags: ["test-noise"],
  category: "Performance",
  recommendation:
    "Use the callback form: `setState(prev => prev + 1)` to always read the latest value",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isSetterCall(node)) return;
      if (!node.arguments?.length) return;
      if (!isNodeOfType(node.callee, "Identifier")) return;
      if (!isUseStateSetterInScope(node, node.callee.name)) return;

      const calleeName = node.callee.name;
      const argument = node.arguments[0];
      const expectedStateName = deriveStateVariableName(calleeName);

      // The arithmetic / update shapes are hazardous when the closure runs
      // past later renders (deferred execution) or when one stale value can
      // feed two updates before a render (a second call to the same setter
      // in the same handler). A lone `setPage(page - 1)` in a plain sync
      // handler re-reads fresh state every discrete event and cannot lose
      // an update.
      const canSyncArithmeticGoStale = (): boolean =>
        isInsideDeferredCallback(node) ||
        hasMultipleSetterCallsInEnclosingFunction(node, calleeName);

      if (
        isNodeOfType(argument, "BinaryExpression") &&
        STATE_ARITHMETIC_OPERATORS.has(argument.operator) &&
        expectedStateName &&
        canSyncArithmeticGoStale()
      ) {
        const matchesExpected = (operand: EsTreeNode | undefined): boolean =>
          isNodeOfType(operand, "Identifier") && operand.name === expectedStateName;

        const stateIdentifier = matchesExpected(argument.left)
          ? argument.left
          : matchesExpected(argument.right)
            ? argument.right
            : null;

        if (isNodeOfType(stateIdentifier, "Identifier")) {
          context.report({
            node,
            message: `You can lose this update because ${calleeName}(${stateIdentifier.name} ${argument.operator} ...) reads a stale value.`,
          });
          return;
        }
      }

      if (
        isNodeOfType(argument, "UpdateExpression") &&
        (argument.operator === "++" || argument.operator === "--") &&
        isNodeOfType(argument.argument, "Identifier") &&
        argument.argument.name === expectedStateName &&
        canSyncArithmeticGoStale()
      ) {
        const display = argument.prefix
          ? `${argument.operator}${argument.argument.name}`
          : `${argument.argument.name}${argument.operator}`;
        context.report({
          node,
          message: `You can lose this update because ${calleeName}(${display}) reads a stale value & ++ grabs the wrong one.`,
        });
        return;
      }

      // HACK: 'Removing Effect Dependencies' §"Are you reading some
      // state to calculate the next state?" — the array/object spread
      // shape is the most common stale-closure trap in
      // subscription-handler / setInterval callbacks:
      //
      //   setMessages([...messages, receivedMessage]);   // stale
      //   setMessages(msgs => [...msgs, receivedMessage]); // ok
      //
      // Detect when one of the spread sources structurally references
      // the derived state variable: `setX([...x, ...])` or
      // `setX({ ...x, key: value })`.
      //
      // GATE (spread shapes): a spread merge is flagged only when the
      // call site is inside a deferred-execution context (setTimeout,
      // .then(), addEventListener, useEffect, debounce, …) where the
      // closure survives past later renders and the captured state goes
      // stale. Synchronous render-path handlers (`onClick={() =>
      // setX({...x, …})}`) close over fresh state every render. The
      // arithmetic / update shapes above additionally fire in a sync
      // handler that calls the same setter twice — that's the batching
      // case where one stale read feeds two updates before a render.
      if (!isInsideDeferredCallback(node)) return;
      if (expectedStateName && isNodeOfType(argument, "ArrayExpression")) {
        const spreadsState = (argument.elements ?? []).some(
          (element: EsTreeNode | null) =>
            isNodeOfType(element, "SpreadElement") &&
            isNodeOfType(element.argument, "Identifier") &&
            element.argument.name === expectedStateName,
        );
        if (spreadsState) {
          context.report({
            node,
            message: `You can lose this update because ${calleeName}([...${expectedStateName}, ...]) reads a stale value.`,
          });
          return;
        }
      }

      if (expectedStateName && isNodeOfType(argument, "ObjectExpression")) {
        const spreadsState = (argument.properties ?? []).some(
          (property: EsTreeNode | null) =>
            isNodeOfType(property, "SpreadElement") &&
            isNodeOfType(property.argument, "Identifier") &&
            property.argument.name === expectedStateName,
        );
        if (spreadsState) {
          context.report({
            node,
            message: `You can lose this update because ${calleeName}({ ...${expectedStateName}, ... }) reads a stale value.`,
          });
          return;
        }
      }
    },
  }),
});
