import { defineRule } from "../../utils/define-rule.js";
import { getNextStaticJsxElementSibling } from "../../utils/get-next-static-jsx-element-sibling.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindFillOrEdge } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { isTailwindCardSurface } from "./utils/is-tailwind-card-surface.js";

const CARD_HEADING_PATTERN = /^h[2-4]$/;
const ICON_COMPONENT_PATTERN = /Icon$/;

const containsIcon = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  const elementName = node.openingElement.name;
  if (
    isNodeOfType(elementName, "JSXIdentifier") &&
    (elementName.name === "svg" || ICON_COMPONENT_PATTERN.test(elementName.name))
  ) {
    return true;
  }
  return (node.children ?? []).some(
    (child) => isNodeOfType(child, "JSXElement") && containsIcon(child),
  );
};

const isIconTile = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  if (!containsIcon(node)) return false;
  const classNameValue = getStringFromClassNameAttr(node.openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  const hasTileSize = tokens.some((token) => /^(?:size|h|w)-(?:8|9|10|11|12|14|16)$/.test(token));
  const hasRoundedShape = tokens.some(
    (token) => token === "rounded" || (token.startsWith("rounded-") && token !== "rounded-none"),
  );
  const hasSurface = hasVisibleTailwindFillOrEdge(tokens);
  return hasTileSize && hasRoundedShape && hasSurface;
};

export const noIconTileHeadingStack = defineRule({
  id: "no-icon-tile-heading-stack",
  title: "Card stacks an icon tile above its heading",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Place the icon beside the heading or let it sit in the content flow without another boxed surface.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isIconTile(node)) return;
      const parent = node.parent;
      if (!isNodeOfType(parent, "JSXElement") || !isTailwindCardSurface(parent.openingElement)) {
        return;
      }
      const heading = getNextStaticJsxElementSibling(node);
      if (
        !heading ||
        !isNodeOfType(heading.openingElement.name, "JSXIdentifier") ||
        !CARD_HEADING_PATTERN.test(heading.openingElement.name.name)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This card adds a separate rounded icon tile directly above the heading. Simplify the hierarchy or align the icon with the title.",
      });
    },
  }),
});
