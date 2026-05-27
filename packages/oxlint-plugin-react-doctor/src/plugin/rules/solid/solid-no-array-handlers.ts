import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isDomElementName } from "../../utils/is-dom-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isEventHandlerName = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (isNodeOfType(attribute.name, "JSXNamespacedName")) {
    return attribute.name.namespace.name === "on";
  }
  if (isNodeOfType(attribute.name, "JSXIdentifier")) {
    return /^on[a-zA-Z]/.test(attribute.name.name);
  }
  return false;
};

// Port of `solid/no-array-handlers` — Solid supports
// `onClick={[handler, args]}` for type-unsafe event-handler binding;
// flag it because it bypasses Solid's compile-time handler typing.
export const solidNoArrayHandlers = defineRule<Rule>({
  id: "solid-no-array-handlers",
  severity: "warn",
  requires: ["solid"],
  defaultEnabled: false,
  recommendation:
    "Use a function (or `.bind(...)`) instead of `onClick={[handler, args]}` — array handlers are type-unsafe.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const opening = node.parent;
      if (!opening || !isNodeOfType(opening, "JSXOpeningElement")) return;
      if (!isNodeOfType(opening.name, "JSXIdentifier")) return;
      if (!isDomElementName(opening.name.name)) return;
      if (!isEventHandlerName(node)) return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;
      if (!isNodeOfType(node.value.expression, "ArrayExpression")) return;
      context.report({
        node,
        message: "Passing an array as an event handler is potentially type-unsafe.",
      });
    },
  }),
});
