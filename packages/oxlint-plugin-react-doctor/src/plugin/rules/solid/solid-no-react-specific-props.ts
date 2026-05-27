import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REACT_SPECIFIC_PROPS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "className", to: "class" },
  { from: "htmlFor", to: "for" },
];

const isDomElementName = (name: string): boolean => /^[a-z]/.test(name);

// Port of `solid/no-react-specific-props` — flag React holdover props
// (`className`, `htmlFor`) that Solid renamed to `class` / `for`,
// plus the leftover `key` prop on DOM elements (Solid's `<For>` /
// `<Index>` don't use keys).
export const solidNoReactSpecificProps = defineRule<Rule>({
  id: "solid-no-react-specific-props",
  severity: "error",
  requires: ["solid"],
  recommendation: "Use `class` instead of `className` and `for` instead of `htmlFor` in Solid JSX.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const { from, to } of REACT_SPECIFIC_PROPS) {
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          if (attribute.name.name === from) {
            context.report({
              node: attribute,
              message: `Prefer the \`${to}\` prop over the deprecated \`${from}\` prop.`,
            });
          }
        }
      }
      if (!isNodeOfType(node.name, "JSXIdentifier") || !isDomElementName(node.name.name)) return;
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        if (attribute.name.name === "key") {
          context.report({
            node: attribute,
            message: "Elements in a <For> or <Index> list do not need a `key` prop in Solid.",
          });
        }
      }
    },
  }),
});
