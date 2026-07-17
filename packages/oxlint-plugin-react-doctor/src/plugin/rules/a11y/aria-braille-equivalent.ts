import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";

const ACCESSIBLE_NAME_ATTRIBUTES: ReadonlyArray<string> = [
  "aria-label",
  "aria-labelledby",
  "alt",
  "title",
];

const hasNonemptyLiteralAttribute = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean | null => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName, false);
  if (!attribute) return false;
  const value = getStringLiteralAttributeValue(attribute);
  return value === null ? null : value.trim().length > 0;
};

export const ariaBrailleEquivalent = defineRule({
  id: "aria-braille-equivalent",
  title: "Braille-only accessible description",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Pair braille-specific labels and role descriptions with an equivalent accessible name or role description.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (hasJsxSpreadAttribute(openingElement.attributes)) return;
      const brailleRoleDescription = hasNonemptyLiteralAttribute(
        openingElement,
        "aria-brailleroledescription",
      );
      if (brailleRoleDescription === true) {
        const roleDescription = hasNonemptyLiteralAttribute(openingElement, "aria-roledescription");
        if (roleDescription === false) {
          const attribute = getAuthoritativeJsxAttribute(
            openingElement.attributes,
            "aria-brailleroledescription",
            false,
          );
          if (attribute) {
            context.report({
              node: attribute,
              message:
                "This braille role description has no non-braille equivalent. Add a nonempty aria-roledescription for other assistive technologies.",
            });
          }
        }
      }

      const brailleLabel = hasNonemptyLiteralAttribute(openingElement, "aria-braillelabel");
      if (brailleLabel !== true || objectHasAccessibleChild(node, context.settings)) {
        return;
      }
      const accessibleNameStates = ACCESSIBLE_NAME_ATTRIBUTES.map((attributeName) =>
        hasNonemptyLiteralAttribute(openingElement, attributeName),
      );
      if (accessibleNameStates.some((state) => state === true || state === null)) return;
      const attribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "aria-braillelabel",
        false,
      );
      if (!attribute) return;
      context.report({
        node: attribute,
        message:
          "This braille label is the element's only accessible name. Add visible text, aria-label, aria-labelledby, alt, or title for non-braille assistive technology.",
      });
    },
  }),
});
