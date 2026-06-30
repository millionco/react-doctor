import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
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
// useInsertionEffect / setTimeout / .then(...) / addEventListener / …)
// remain in the list.
const DEFERRED_EXECUTION_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
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
      if (calleeName && DEFERRED_EXECUTION_CALLEE_NAMES.has(calleeName)) return true;
      // Keep walking — we might be inside a nested fn whose own enclosing
      // call IS deferred.
    }
    current = parent;
  }
  return false;
};

// Dep identifiers of the nearest enclosing useEffect / useLayoutEffect, or
// null when there is no such effect (or its second argument isn't a literal
// deps array). When the read state is among these, the effect re-runs — and
// its closure refreshes — every time that state changes, so the deferred
// setter never reads a stale value.
const getEnclosingEffectDependencyNames = (node: EsTreeNode): Set<string> | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "CallExpression") && isHookCall(current, EFFECT_HOOK_NAMES)) {
      const dependencyArray = current.arguments?.[1];
      if (!isNodeOfType(dependencyArray, "ArrayExpression")) return null;
      const dependencyNames = new Set<string>();
      for (const element of dependencyArray.elements ?? []) {
        if (isNodeOfType(element, "Identifier")) dependencyNames.add(element.name);
      }
      return dependencyNames;
    }
    current = current.parent;
  }
  return null;
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

      // GATE (all shapes): a stale read can only lose an update when the
      // setter runs AFTER a later render — i.e. from a deferred callback
      // (setTimeout / .then() / addEventListener / useEffect / …). A
      // synchronous render-path handler (`onClick={() => setIndex(index +
      // 1)}`) closes over the current render's fresh state and fires once
      // per event, so it cannot lose its own update. This used to gate
      // only the spread shapes; the arithmetic / update shapes over-
      // reported one-shot handlers without it.
      if (!isInsideDeferredCallback(node)) return;

      // The read state is a dependency of the enclosing effect, so the effect
      // re-runs and rebuilds the closure on every change — the timer/handler
      // always reads the latest value and cannot lose an update.
      if (expectedStateName) {
        const effectDependencyNames = getEnclosingEffectDependencyNames(node);
        if (effectDependencyNames?.has(expectedStateName)) return;
      }

      if (
        isNodeOfType(argument, "BinaryExpression") &&
        STATE_ARITHMETIC_OPERATORS.has(argument.operator) &&
        expectedStateName
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
        argument.argument.name === expectedStateName
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
