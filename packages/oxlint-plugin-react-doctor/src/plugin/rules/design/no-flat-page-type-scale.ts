import { MIN_PAGE_TYPE_SCALE_RATIO, PAGE_TYPE_SCALE_MIN_STEPS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStaticEffectiveFontSize } from "./utils/get-static-effective-font-size.js";

export const noFlatPageTypeScale = defineRule({
  id: "no-flat-page-type-scale",
  title: "Page typography uses a compressed size range",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use a clearer size hierarchy when a page declares several explicit typography steps.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== "main"
      ) {
        return;
      }
      const fontSizes = new Set<number>();
      const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        const fontSize = getStaticEffectiveFontSize(openingElement, hasTailwind);
        if (fontSize !== null) fontSizes.add(fontSize);
      }
      if (fontSizes.size < PAGE_TYPE_SCALE_MIN_STEPS) return;
      const orderedSizes = [...fontSizes].sort((leftSize, rightSize) => leftSize - rightSize);
      const smallestSize = orderedSizes[0];
      const largestSize = orderedSizes.at(-1);
      if (
        !smallestSize ||
        !largestSize ||
        largestSize / smallestSize >= MIN_PAGE_TYPE_SCALE_RATIO
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message: `This page declares ${fontSizes.size} text sizes within less than a ${MIN_PAGE_TYPE_SCALE_RATIO}× range. Increase the hierarchy between supporting and display text.`,
      });
    },
  }),
});
