import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const HEADER_ROLES: ReadonlySet<string> = new Set(["columnheader", "rowheader"]);

const hasPotentialAccessibleName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  for (const attributeName of ["aria-label", "aria-labelledby"]) {
    const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
    if (!attribute) continue;
    const value = getStringLiteralAttributeValue(attribute);
    if (value === null || value.trim().length > 0) return true;
  }
  return false;
};

export const emptyTableHeader = defineRule({
  id: "empty-table-header",
  title: "Table header has no accessible text",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation: "Give every table header concise text or an explicit accessible name.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      const elementType = resolveJsxElementType(openingElement);
      if (/^[A-Z]/.test(elementType)) return;
      const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
      const role = roleAttribute
        ? getStringLiteralAttributeValue(roleAttribute)?.toLowerCase()
        : null;
      if (elementType !== "th" && (!role || !HEADER_ROLES.has(role))) {
        return;
      }
      if (objectHasAccessibleChild(node, context.settings)) return;
      if (hasPotentialAccessibleName(openingElement)) return;
      context.report({
        node: openingElement,
        message:
          "This table header has no accessible text, so users cannot tell what its cells represent. Add header text or an accessible name.",
      });
    },
  }),
});
