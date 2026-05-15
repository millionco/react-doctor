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

export const rerenderFunctionalSetstate = defineRule<Rule>({
  id: "rerender-functional-setstate",
  severity: "warn",
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
            message: `${calleeName}(${stateIdentifier.name} ${argument.operator} ...) — use functional update to avoid stale closures`,
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
          message: `${calleeName}(${display}) — use functional update to avoid stale closures (and reading the post-increment value bug)`,
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
            message: `${calleeName}([...${expectedStateName}, ...]) — use functional update \`${calleeName}(prev => [...prev, ...])\` to avoid stale closures`,
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
            message: `${calleeName}({ ...${expectedStateName}, ... }) — use functional update \`${calleeName}(prev => ({ ...prev, ... }))\` to avoid stale closures`,
          });
          return;
        }
      }
    },
  }),
});
