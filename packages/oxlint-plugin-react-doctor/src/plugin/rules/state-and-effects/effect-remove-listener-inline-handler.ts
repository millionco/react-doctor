import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Removal verbs that deregister a listener by reference equality on the
// handler argument. Excludes `addEventListener` on purpose — a fresh
// literal is only a bug on the REMOVE side.
const REFERENCE_EQUALITY_REMOVAL_METHOD_NAMES = new Set([
  "removeEventListener",
  "removeListener",
  "off",
  "unsubscribe",
]);

const isFreshFunctionReference = (node: EsTreeNode): boolean => {
  const handler = stripParenExpression(node);
  if (
    isNodeOfType(handler, "ArrowFunctionExpression") ||
    isNodeOfType(handler, "FunctionExpression")
  ) {
    return true;
  }
  return (
    isNodeOfType(handler, "CallExpression") &&
    isNodeOfType(handler.callee, "MemberExpression") &&
    !handler.callee.computed &&
    isNodeOfType(handler.callee.property, "Identifier") &&
    handler.callee.property.name === "bind"
  );
};

export const effectRemoveListenerInlineHandler = defineRule({
  id: "effect-remove-listener-inline-handler",
  title: "removeEventListener called with a fresh inline handler",
  severity: "error",
  category: "Bugs",
  recommendation:
    "Removal APIs match the listener by reference equality, so a fresh inline arrow, function expression, or `.bind(...)` result can never equal the registered handler; hoist the handler into a named const and pass that same reference to both the add and remove calls.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (!REFERENCE_EQUALITY_REMOVAL_METHOD_NAMES.has(callee.property.name)) return;

      const args = node.arguments ?? [];
      if (args.length < 2) return;
      const handlerArgument = args[1];
      if (!handlerArgument || !isFreshFunctionReference(handlerArgument)) return;

      context.report({
        node: handlerArgument,
        message: `\`${callee.property.name}\` gets a brand-new function reference here that never equals the registered listener, so the removal silently no-ops and the listener leaks; pass the same named handler to both the add and remove calls.`,
      });
    },
  }),
});
