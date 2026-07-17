import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxTreeOpeningElements } from "../../utils/get-static-jsx-tree-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const LABELABLE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

export const noMultipleLabelsForControl = defineRule({
  id: "no-multiple-labels-for-control",
  title: "Form control has multiple explicit labels",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation: "Combine the label text into one label element for each form control.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElements = getStaticJsxTreeOpeningElements(node.openingElement);
      if (!openingElements) return;

      const controlIds = new Set<string>();
      for (const openingElement of openingElements) {
        if (!LABELABLE_ELEMENT_TYPES.has(resolveJsxElementType(openingElement))) continue;
        const idAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "id", false);
        const id = idAttribute ? getStringLiteralAttributeValue(idAttribute)?.trim() : null;
        if (id) controlIds.add(id);
      }

      const firstLabelByControlId = new Map<string, EsTreeNodeOfType<"JSXAttribute">>();
      for (const openingElement of openingElements) {
        if (resolveJsxElementType(openingElement) !== "label") continue;
        const htmlForAttribute = getAuthoritativeJsxAttribute(
          openingElement.attributes,
          "htmlFor",
          false,
        );
        const controlId = htmlForAttribute
          ? getStringLiteralAttributeValue(htmlForAttribute)?.trim()
          : null;
        if (!htmlForAttribute || !controlId || !controlIds.has(controlId)) continue;
        if (!firstLabelByControlId.has(controlId)) {
          firstLabelByControlId.set(controlId, htmlForAttribute);
          continue;
        }
        context.report({
          node: htmlForAttribute,
          message: `More than one label points to "${controlId}" in this static JSX tree, which assistive technologies announce inconsistently. Combine the text into one label.`,
        });
      }
    },
  }),
});
