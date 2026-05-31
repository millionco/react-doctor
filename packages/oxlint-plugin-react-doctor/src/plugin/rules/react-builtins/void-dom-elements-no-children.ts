import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const VOID_DOM_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "menuitem",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const buildMessage = (tag: string): string =>
  `React errors when \`<${tag}>\` has children because it's a void element.`;

const findChildrenLikePropName = (
  attributes: ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">["attributes"][number]>,
): boolean => {
  for (const attribute of attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
    if (attribute.name.name === "children" || attribute.name.name === "dangerouslySetInnerHTML") {
      return true;
    }
  }
  return false;
};

// Port of `oxc_linter::rules::react::void_dom_elements_no_children`.
// Reports `<img>Children</img>`, `<br children="…" />`, void elements
// passing dangerouslySetInnerHTML, and the `React.createElement` analogues.
export const voidDomElementsNoChildren = defineRule<Rule>({
  id: "void-dom-elements-no-children",
  title: "Children on a void element",
  severity: "warn",
  recommendation: "Remove the children, or use a tag that can hold children.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return;
      const tagName = openingElement.name.name;
      if (!VOID_DOM_ELEMENTS.has(tagName)) return;
      const hasChildrenContent = node.children.length > 0;
      const hasChildrenLikeProp = findChildrenLikePropName(openingElement.attributes);
      if (hasChildrenContent || hasChildrenLikeProp) {
        context.report({ node: openingElement.name, message: buildMessage(tagName) });
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateElementCall(node)) return;
      const firstArgument = node.arguments[0];
      if (!firstArgument) return;
      if (!isNodeOfType(firstArgument, "Literal") || typeof firstArgument.value !== "string")
        return;
      const tagName = firstArgument.value;
      if (!VOID_DOM_ELEMENTS.has(tagName)) return;

      const propsArgument = node.arguments[1];
      const childrenArguments = node.arguments.slice(2);
      let hasChildrenLikeProp = false;
      if (propsArgument && isNodeOfType(propsArgument, "ObjectExpression")) {
        for (const property of propsArgument.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          const propertyKey = property.key;
          const matches =
            (isNodeOfType(propertyKey, "Identifier") &&
              (propertyKey.name === "children" ||
                propertyKey.name === "dangerouslySetInnerHTML")) ||
            (isNodeOfType(propertyKey, "Literal") &&
              (propertyKey.value === "children" ||
                propertyKey.value === "dangerouslySetInnerHTML"));
          if (matches) {
            hasChildrenLikeProp = true;
            break;
          }
        }
      }
      if (childrenArguments.length > 0 || hasChildrenLikeProp) {
        context.report({ node: firstArgument, message: buildMessage(tagName) });
      }
    },
  }),
});
