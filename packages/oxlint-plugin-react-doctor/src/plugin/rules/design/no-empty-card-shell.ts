import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindFillOrEdge } from "./utils/has-visible-tailwind-fill-or-edge.js";

const SEMANTIC_SURFACE_ELEMENTS = new Set(["article", "aside", "section"]);
const PADDING_PATTERN = /^p[xytrbles]?-(?:px|[\d.]+|\[[^\]]+\])$/;
const SKELETON_PATTERN = /^(?:animate-|skeleton$|shimmer$|placeholder$)/;
const CONTENT_ATTRIBUTES = new Set([
  "children",
  "contentEditable",
  "dangerouslySetInnerHTML",
  "role",
]);

export const noEmptyCardShell = defineRule({
  id: "no-empty-card-shell",
  title: "Empty semantic element renders as a card",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Render meaningful content or remove the bordered, rounded shell until content exists.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !SEMANTIC_SURFACE_ELEMENTS.has(node.openingElement.name.name) ||
        node.children.some(
          (child) => !isNodeOfType(child, "JSXText") || Boolean(child.value?.trim()),
        ) ||
        node.openingElement.attributes.some(
          (attribute) =>
            isNodeOfType(attribute, "JSXSpreadAttribute") ||
            (isNodeOfType(attribute, "JSXAttribute") &&
              CONTENT_ATTRIBUTES.has(getJsxAttributeName(attribute.name) ?? "")),
        )
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (
        !tokens.some((token) => token === "rounded" || token.startsWith("rounded-")) ||
        !tokens.some((token) => PADDING_PATTERN.test(token)) ||
        !hasVisibleTailwindFillOrEdge(tokens) ||
        tokens.some((token) => SKELETON_PATTERN.test(token))
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This empty semantic container still draws a padded card shell. Remove the surface until it has content, or render a purposeful empty state.",
      });
    },
  }),
});
