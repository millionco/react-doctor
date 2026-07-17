import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxTreeOpeningElements } from "../../utils/get-static-jsx-tree-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

export const iframeTitleUnique = defineRule({
  id: "iframe-title-unique",
  title: "Frame title is duplicated",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Give each frame a concise title that distinguishes its purpose from sibling frames.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElements = getStaticJsxTreeOpeningElements(node.openingElement);
      if (!openingElements) return;

      const firstTitle = new Map<string, EsTreeNodeOfType<"JSXAttribute">>();
      for (const openingElement of openingElements) {
        const elementType = resolveJsxElementType(openingElement);
        if (elementType !== "iframe" && elementType !== "frame") continue;
        const titleAttribute = getAuthoritativeJsxAttribute(
          openingElement.attributes,
          "title",
          false,
        );
        const rawTitle = titleAttribute ? getStringLiteralAttributeValue(titleAttribute) : null;
        const normalizedTitle = rawTitle?.replace(/\s+/g, " ").trim().toLowerCase();
        if (!titleAttribute || !normalizedTitle) continue;
        if (!firstTitle.has(normalizedTitle)) {
          firstTitle.set(normalizedTitle, titleAttribute);
          continue;
        }
        context.report({
          node: titleAttribute,
          message: `Another frame in this static JSX tree already uses the title "${rawTitle?.trim()}". Give each frame a title that identifies its distinct purpose.`,
        });
      }
    },
  }),
});
