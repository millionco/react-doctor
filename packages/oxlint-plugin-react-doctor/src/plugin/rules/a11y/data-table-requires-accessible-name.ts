import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const dataTableRequiresAccessibleName = defineRule({
  id: "data-table-requires-accessible-name",
  title: "Data table has no accessible name",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Give data tables a concise caption, or reference an existing visible title with aria-labelledby.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (
        resolveJsxElementType(openingElement) !== "table" ||
        hasJsxSpreadAttribute(openingElement.attributes)
      ) {
        return;
      }
      const roleAttribute = findJsxAttribute(openingElement.attributes, "role");
      const role = roleAttribute ? getStringLiteralAttributeValue(roleAttribute) : null;
      if (role === "presentation" || role === "none") return;
      const descendants = getStaticJsxDescendantOpeningElements(node);
      if (!descendants.some((descendant) => resolveJsxElementType(descendant) === "th")) return;
      if (
        descendants.some(
          (descendant) =>
            descendant.parent?.parent === node && resolveJsxElementType(descendant) === "caption",
        ) ||
        findJsxAttribute(openingElement.attributes, "aria-label") ||
        findJsxAttribute(openingElement.attributes, "aria-labelledby")
      ) {
        return;
      }
      context.report({
        node: openingElement,
        message:
          "This data table has headers but no accessible name. Add a caption or connect the table to a visible title with aria-labelledby.",
      });
    },
  }),
});
