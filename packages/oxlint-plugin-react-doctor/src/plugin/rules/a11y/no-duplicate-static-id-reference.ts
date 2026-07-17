import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxTreeOpeningElements } from "../../utils/get-static-jsx-tree-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const ID_REFERENCE_ATTRIBUTES: ReadonlyArray<string> = [
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "htmlFor",
];

export const noDuplicateStaticIdReference = defineRule({
  id: "no-duplicate-static-id-reference",
  title: "Referenced ID is duplicated",
  severity: "error",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Give every statically referenced element a unique id within the rendered JSX tree.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElements = getStaticJsxTreeOpeningElements(node.openingElement);
      if (!openingElements) return;

      const idAttributes = new Map<string, Array<EsTreeNodeOfType<"JSXAttribute">>>();
      const referencedIds = new Set<string>();
      for (const openingElement of openingElements) {
        const elementType = resolveJsxElementType(openingElement);
        if (/^[A-Z]/.test(elementType)) continue;
        const idAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "id", false);
        const id = idAttribute ? getStringLiteralAttributeValue(idAttribute)?.trim() : null;
        if (idAttribute && id) {
          const attributes = idAttributes.get(id) ?? [];
          attributes.push(idAttribute);
          idAttributes.set(id, attributes);
        }
        for (const attributeName of ID_REFERENCE_ATTRIBUTES) {
          const referenceAttribute = getAuthoritativeJsxAttribute(
            openingElement.attributes,
            attributeName,
            false,
          );
          const referenceValue = referenceAttribute
            ? getStringLiteralAttributeValue(referenceAttribute)
            : null;
          if (!referenceValue) continue;
          for (const referencedId of referenceValue.split(/\s+/)) {
            if (referencedId) referencedIds.add(referencedId);
          }
        }
      }

      for (const [id, attributes] of idAttributes) {
        if (!referencedIds.has(id) || attributes.length < 2) continue;
        for (const duplicateAttribute of attributes.slice(1)) {
          context.report({
            node: duplicateAttribute,
            message: `The referenced id "${id}" appears more than once in this static JSX tree, so labels and ARIA relationships can resolve to the wrong element. Make it unique.`,
          });
        }
      }
    },
  }),
});
