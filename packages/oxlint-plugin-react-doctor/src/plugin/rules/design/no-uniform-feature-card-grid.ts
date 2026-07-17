import { UNIFORM_FEATURE_CARD_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticDirectJsxElements } from "../../utils/get-static-direct-jsx-elements.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { isTailwindCardSurface } from "./utils/is-tailwind-card-surface.js";

const GRID_CONTAINER_NAMES = new Set(["div", "section"]);
const CARD_HEADING_PATTERN = /^h[2-4]$/;

const hasFeatureCopy = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  const descendants = getStaticJsxDescendantOpeningElements(element);
  const hasHeading = descendants.some(
    (openingElement) =>
      isNodeOfType(openingElement.name, "JSXIdentifier") &&
      CARD_HEADING_PATTERN.test(openingElement.name.name),
  );
  const hasParagraph = descendants.some(
    (openingElement) =>
      isNodeOfType(openingElement.name, "JSXIdentifier") && openingElement.name.name === "p",
  );
  return hasHeading && hasParagraph;
};

export const noUniformFeatureCardGrid = defineRule({
  id: "no-uniform-feature-card-grid",
  title: "Feature grid repeats one card recipe",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Vary the composition, group related capabilities, or choose a denser list when every feature receives the same card weight.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !GRID_CONTAINER_NAMES.has(node.openingElement.name.name)
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue || !getUnvariantClassNameTokens(classNameValue).includes("grid")) return;
      const directElements = getStaticDirectJsxElements(node);
      if (directElements.length < UNIFORM_FEATURE_CARD_MIN_COUNT) return;
      if (
        !directElements.every(
          (element) => isTailwindCardSurface(element.openingElement) && hasFeatureCopy(element),
        )
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message: `All ${directElements.length} items in this grid use the same rounded card-and-heading recipe. Introduce hierarchy or a composition specific to the content.`,
      });
    },
  }),
});
