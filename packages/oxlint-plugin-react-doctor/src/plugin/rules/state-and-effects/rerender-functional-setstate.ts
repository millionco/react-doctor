import { defineRule } from "../../utils/define-rule.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
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

export const rerenderFunctionalSetstate = defineRule<Rule>({
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

      const calleeName = node.callee.name;
      const argument = node.arguments[0];
      const expectedStateName = deriveStateVariableName(calleeName);

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
      //
      // GATE: only flag when the call site is inside a deferred-execution
      // context (setTimeout, .then(), addEventListener, useEffect, …).
      // Synchronous render-path handlers (`onClick`, `onChange`) close
      // over fresh state every render — no stale-closure risk there.
      const spreadIsInDeferredContext = isInsideDeferredCallback(node);
      if (!spreadIsInDeferredContext) return;
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
