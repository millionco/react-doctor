import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "A `children` prop can override or hide nested children, so the component may render different content than the JSX shows.";

// Port of `oxc_linter::rules::react::no_children_prop`. Reports two
// shapes:
//   1. A `JSXAttribute` whose name is the identifier `children`.
//   2. A `React.createElement(type, { children: ... })` call where the
//      props bag (the second argument) contains a static `children` key.
export const noChildrenProp = defineRule<Rule>({
  id: "no-children-prop",
  title: "Children passed as a prop",
  severity: "warn",
  recommendation:
    "Nest children between the tags so the rendered content is visible in JSX and cannot be hidden inside a props object.",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "children") return;
      context.report({ node: node.name, message: MESSAGE });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateElementCall(node)) return;
      const propsArgument = node.arguments[1];
      if (!propsArgument) return;
      if (!isNodeOfType(propsArgument, "ObjectExpression")) return;
      for (const property of propsArgument.properties) {
        if (!isNodeOfType(property, "Property")) continue;
        const propertyKey = property.key;
        if (
          (isNodeOfType(propertyKey, "Identifier") && propertyKey.name === "children") ||
          (isNodeOfType(propertyKey, "Literal") && propertyKey.value === "children")
        ) {
          context.report({ node: propertyKey, message: MESSAGE });
        }
      }
    },
  }),
});
