import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isDomElementName } from "../../utils/is-dom-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface RenameMapping {
  reactName: string;
  solidName: string;
}

const REACT_SPECIFIC_PROPS: ReadonlyArray<RenameMapping> = [
  { reactName: "className", solidName: "class" },
  { reactName: "htmlFor", solidName: "for" },
];

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
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const isDomElement = isDomElementName(node.name.name);
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        const attributeName = attribute.name.name;
        const matchedMapping = REACT_SPECIFIC_PROPS.find(
          (mapping) => mapping.reactName === attributeName,
        );
        if (matchedMapping) {
          context.report({
            node: attribute,
            message: `Prefer the \`${matchedMapping.solidName}\` prop over the deprecated \`${matchedMapping.reactName}\` prop.`,
          });
        }
        if (isDomElement && attributeName === "key") {
          context.report({
            node: attribute,
            message: "Elements in a <For> or <Index> list do not need a `key` prop in Solid.",
          });
        }
      }
    },
  }),
});
