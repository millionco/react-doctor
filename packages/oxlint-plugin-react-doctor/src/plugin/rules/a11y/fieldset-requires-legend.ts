import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const FIELD_TAG_NAMES = new Set(["input", "select", "textarea"]);

export const fieldsetRequiresLegend = defineRule({
  id: "fieldset-requires-legend",
  title: "Fieldset group has no legend",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Name grouped controls with a direct legend, or an explicit accessible name when no visible group label is appropriate.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (
        resolveJsxElementType(openingElement) !== "fieldset" ||
        hasJsxSpreadAttribute(openingElement.attributes)
      ) {
        return;
      }
      const descendants = getStaticJsxDescendantOpeningElements(node);
      const fieldCount = descendants.filter((descendant) =>
        FIELD_TAG_NAMES.has(resolveJsxElementType(descendant)),
      ).length;
      if (fieldCount < 2) return;
      if (
        descendants.some(
          (descendant) =>
            descendant.parent?.parent === node && resolveJsxElementType(descendant) === "legend",
        ) ||
        findJsxAttribute(openingElement.attributes, "aria-label") ||
        findJsxAttribute(openingElement.attributes, "aria-labelledby")
      ) {
        return;
      }
      context.report({
        node: openingElement,
        message:
          "This fieldset groups multiple controls without naming the group. Add a direct legend or an explicit accessible name.",
      });
    },
  }),
});
