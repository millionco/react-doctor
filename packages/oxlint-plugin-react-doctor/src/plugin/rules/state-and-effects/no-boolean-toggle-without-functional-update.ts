import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// `setCount` → `count`. We only flag when the negated operand is exactly this
// derived name, so `setDisabled(!isValid)` (a different variable) stays quiet.
const deriveStateVariableName = (setterName: string): string | null => {
  if (!setterName.startsWith("set") || setterName.length < 4) return null;
  return setterName.charAt(3).toLowerCase() + setterName.slice(4);
};

// Callees that defer execution past the current render — a toggle captured by
// one of these closures can read stale state because the callback runs after
// later renders. A synchronous `onClick={() => setX(!x)}` recreates the arrow
// (and re-reads fresh `x`) every render, so it is not a stale-read hazard.
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
      if (calleeName && DEFERRED_EXECUTION_CALLEE_NAMES.has(calleeName))
        return true;
    }
    current = parent;
  }
  return false;
};

export const noBooleanToggleWithoutFunctionalUpdate = defineRule({
  id: "no-boolean-toggle-without-functional-update",
  title: "Boolean toggle reads a stale value",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "Toggle boolean state with the functional updater `setX(prev => !prev)` so a deferred double-toggle always reads the latest committed value.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isSetterCall(node)) return;
      if (!node.arguments?.length) return;
      if (!isNodeOfType(node.callee, "Identifier")) return;
      if (!isUseStateSetterInScope(node, node.callee.name)) return;

      const argument = node.arguments[0];
      if (
        !isNodeOfType(argument, "UnaryExpression") ||
        argument.operator !== "!"
      )
        return;

      // A bare Identifier only — `!field.value` / `!this.flag` (MemberExpression)
      // and `!isValid()` (CallExpression) are out of scope.
      const operand = stripParenExpression(argument.argument);
      if (!isNodeOfType(operand, "Identifier")) return;

      const expectedStateName = deriveStateVariableName(node.callee.name);
      if (!expectedStateName || operand.name !== expectedStateName) return;

      if (!isInsideDeferredCallback(node)) return;

      context.report({
        node,
        message: `You can lose this update because ${node.callee.name}(!${operand.name}) reads a stale value; use ${node.callee.name}(prev => !prev).`,
      });
    },
  }),
});
