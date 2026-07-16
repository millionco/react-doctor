import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Removal verbs that deregister a listener by reference equality on the
// handler argument. Excludes `addEventListener` on purpose — a fresh
// literal is only a bug on the REMOVE side. Excludes `unsubscribe`
// because APIs like MQTT.js use `unsubscribe(topic, completionCallback)`,
// where an inline second argument is idiomatic and not a leak.
const REFERENCE_EQUALITY_REMOVAL_METHOD_NAMES = new Set([
  "removeEventListener",
  "removeListener",
  "off",
]);

// `light.off(FADE_DURATION_MS, completionCallback)` — a numeric first
// argument means this `off` is a device/animation API (duration +
// completion callback), not an event-emitter deregistration.
const NUMERIC_ARGUMENT_NAME_PATTERN = /(?:duration|delay|timeout|ms)$/i;

const isNumericFirstArgument = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  if (isNodeOfType(inner, "Literal") && typeof inner.value === "number") return true;
  if (!isNodeOfType(inner, "Identifier")) return false;
  if (NUMERIC_ARGUMENT_NAME_PATTERN.test(inner.name)) return true;
  const binding = findVariableInitializer(inner, inner.name);
  if (!binding?.initializer) return false;
  const initializer = stripParenExpression(binding.initializer);
  return isNodeOfType(initializer, "Literal") && typeof initializer.value === "number";
};

const isFreshFunctionReference = (node: EsTreeNode): boolean => {
  const handler = stripParenExpression(node);
  if (isInlineFunctionExpression(handler)) return true;
  return (
    isNodeOfType(handler, "CallExpression") &&
    isMemberProperty(handler.callee, "bind") &&
    !handler.callee.computed
  );
};

export const effectRemoveListenerInlineHandler = defineRule({
  id: "effect-remove-listener-inline-handler",
  title: "removeEventListener called with a fresh inline handler",
  severity: "error",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Removal APIs match the listener by reference equality, so a fresh inline arrow, function expression, or `.bind(...)` result can never equal the registered handler; hoist the handler into a named const and pass that same reference to both the add and remove calls.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (!REFERENCE_EQUALITY_REMOVAL_METHOD_NAMES.has(callee.property.name)) return;

      const args = node.arguments;
      if (args.length < 2) return;
      if (isNumericFirstArgument(args[0] as EsTreeNode)) return;
      const handlerArgument = args[1];
      if (!isFreshFunctionReference(handlerArgument)) return;

      context.report({
        node: handlerArgument,
        message: `\`${callee.property.name}\` gets a brand-new function reference here that never equals the registered listener, so the removal silently no-ops and the listener leaks; pass the same named handler to both the add and remove calls.`,
      });
    },
  }),
});
