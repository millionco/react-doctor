import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const GLOBAL_ARIA_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-atomic",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "aria-busy",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-description",
  "aria-details",
  "aria-disabled",
  "aria-errormessage",
  "aria-flowto",
  "aria-haspopup",
  "aria-invalid",
  "aria-keyshortcuts",
  "aria-label",
  "aria-labelledby",
  "aria-live",
  "aria-owns",
  "aria-relevant",
  "aria-roledescription",
]);

const hasPresentationalSemantics = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  elementType: string,
): boolean => {
  const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
  const role = roleAttribute
    ? getStringLiteralAttributeValue(roleAttribute)?.trim().toLowerCase().split(/\s+/)[0]
    : null;
  if (role === "none" || role === "presentation") return true;
  if (elementType !== "img") return false;
  const altAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "alt", false);
  return altAttribute ? getStringLiteralAttributeValue(altAttribute) === "" : false;
};

export const noPresentationRoleConflict = defineRule({
  id: "no-presentation-role-conflict",
  title: "Presentational element exposes conflicting semantics",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Remove the presentational role, focusability, or global ARIA state so assistive technologies receive one consistent semantic model.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementType = resolveJsxElementType(node);
      if (/^[A-Z]/.test(elementType) || !hasPresentationalSemantics(node, elementType)) return;
      const isFocusable = isFocusableJsxOpeningElement(node, elementType, true);
      const globalAriaAttribute = node.attributes.find(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          GLOBAL_ARIA_ATTRIBUTES.has(getJsxAttributeName(attribute.name)?.toLowerCase() ?? ""),
      );
      if (!isFocusable && !globalAriaAttribute) return;
      context.report({
        node: globalAriaAttribute ?? node.name,
        message:
          "This element is marked presentational but is also focusable or carries global ARIA state, so assistive technologies may expose conflicting semantics. Remove one side of the conflict.",
      });
    },
  }),
});
