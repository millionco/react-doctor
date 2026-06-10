import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "`dangerouslySetInnerHTML` is an XSS hole that runs attacker-controlled HTML in your users' browsers.";

// Port of `oxc_linter::rules::react::no_danger`. Flags any
// `dangerouslySetInnerHTML` prop, both as a JSXAttribute on a JSX element
// and as a property in the props object passed to `React.createElement`.
export const noDanger = defineRule<Rule>({
  id: "no-danger",
  title: "Raw HTML injection can run unsafe markup",
  severity: "warn",
  category: "Security",
  recommendation:
    "Render trusted content as React children so attacker-controlled HTML cannot run in users' browsers.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const propAttribute = hasJsxProp(node.attributes, "dangerouslySetInnerHTML");
      if (!propAttribute) return;
      context.report({ node: propAttribute.name, message: MESSAGE });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateElementCall(node)) return;
      const propsArgument = node.arguments[1];
      if (!propsArgument || !isNodeOfType(propsArgument, "ObjectExpression")) return;
      for (const property of propsArgument.properties) {
        if (!isNodeOfType(property, "Property")) continue;
        const propertyKey = property.key;
        if (
          (isNodeOfType(propertyKey, "Identifier") &&
            propertyKey.name === "dangerouslySetInnerHTML") ||
          (isNodeOfType(propertyKey, "Literal") && propertyKey.value === "dangerouslySetInnerHTML")
        ) {
          context.report({ node: propertyKey, message: MESSAGE });
        }
      }
    },
  }),
});
