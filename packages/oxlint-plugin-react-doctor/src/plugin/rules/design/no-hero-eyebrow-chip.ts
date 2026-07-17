import { SHORT_DECORATIVE_LABEL_MAX_CHARACTERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getNextStaticJsxElementSibling } from "../../utils/get-next-static-jsx-element-sibling.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindFillOrEdge } from "./utils/has-visible-tailwind-fill-or-edge.js";

const HERO_HEADING_SIZE_CLASSES = new Set([
  "text-5xl",
  "text-6xl",
  "text-7xl",
  "text-8xl",
  "text-9xl",
]);

const hasPositivePillPadding = (token: string): boolean => {
  const spacingMatch = token.match(/^p(?:x)?-(px|[\d.]+)$/);
  if (spacingMatch) return spacingMatch[1] === "px" || parseFloat(spacingMatch[1]) > 0;
  const arbitraryMatch = token.match(/^p(?:x)?-\[([\d.]+)(?:px|rem)\]$/);
  return Boolean(arbitraryMatch && parseFloat(arbitraryMatch[1]) > 0);
};

export const noHeroEyebrowChip = defineRule({
  id: "no-hero-eyebrow-chip",
  title: "Hero uses a decorative eyebrow label",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Integrate the context into the headline or navigation instead of adding a generic chip above the hero title.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const labelText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (!labelText || labelText.length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS) return;
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const labelTokens = new Set(getUnvariantClassNameTokens(classNameValue));
      const isTrackedLabel =
        labelTokens.has("uppercase") &&
        [...labelTokens].some((token) => token.startsWith("tracking-"));
      const isPillLabel =
        labelTokens.has("rounded-full") &&
        hasVisibleTailwindFillOrEdge([...labelTokens]) &&
        [...labelTokens].some(hasPositivePillPadding);
      if (!isTrackedLabel && !isPillLabel) return;

      const heading = getNextStaticJsxElementSibling(node);
      if (
        !heading ||
        !isNodeOfType(heading.openingElement.name, "JSXIdentifier") ||
        heading.openingElement.name.name !== "h1"
      ) {
        return;
      }
      const headingClassName = getStringFromClassNameAttr(heading.openingElement);
      if (
        !headingClassName ||
        !getUnvariantClassNameTokens(headingClassName).some((token) =>
          HERO_HEADING_SIZE_CLASSES.has(token),
        )
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This small decorative label immediately above a display headline creates a generic hero scaffold. Fold the context into stronger content structure.",
      });
    },
  }),
});
