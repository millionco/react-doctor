import { EXCESSIVE_CARD_SURFACE_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTailwindCardSurface } from "./utils/is-tailwind-card-surface.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

export const noExcessiveCardSurfaces = defineRule({
  id: "no-excessive-card-surfaces",
  title: "Page boxes too many groups into cards",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Let related content share the page surface and use spacing, dividers, or typography before adding another card boundary.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const cardCount = getStaticJsxOpeningElements(node).filter(isTailwindCardSurface).length;
      if (cardCount < EXCESSIVE_CARD_SURFACE_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page gives ${cardCount} groups a complete rounded card treatment. Flatten secondary groups so the important surfaces keep their visual weight.`,
      });
    },
  }),
});
