import { ACCESSIBLE_NAME_ATTRIBUTE_NAMES } from "../../constants/accessible-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isInsideStaticallyHiddenJsxSubtree } from "../../utils/is-inside-statically-hidden-jsx-subtree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { createRegionReachability } from "./utils/create-region-reachability.js";

const REGION_CONTAINER_TAG_NAMES = new Set([
  "div",
  "section",
  "article",
  "aside",
  "main",
  "nav",
  "header",
  "footer",
]);

export const regionHasAccessibleName = defineRule({
  id: "region-has-accessible-name",
  title: "Region has no naming attribute",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Name explicit regions with aria-label or aria-labelledby referencing a visible heading.",
  create: (context) => {
    const isRegionReachable = createRegionReachability(context);
    return {
      JSXOpeningElement: (node: EsTreeNodeOfType<"JSXOpeningElement">) => {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (!REGION_CONTAINER_TAG_NAMES.has(node.name.name)) return;
        const roleAttribute = getAuthoritativeJsxAttribute(node.attributes, "role", false);
        if (!roleAttribute || getStringLiteralAttributeValue(roleAttribute) !== "region") return;
        if (
          ACCESSIBLE_NAME_ATTRIBUTE_NAMES.some((attributeName) =>
            hasJsxPropIgnoreCase(node.attributes, attributeName),
          )
        ) {
          return;
        }

        let ancestor: EsTreeNode | null | undefined = node.parent;
        while (ancestor) {
          if (isNodeOfType(ancestor, "JSXAttribute")) return;
          if (isNodeOfType(ancestor, "JSXElement")) {
            const openingElement = ancestor.openingElement;
            if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return;
            const tagName = openingElement.name.name;
            if (
              (!REGION_CONTAINER_TAG_NAMES.has(tagName) &&
                tagName !== "html" &&
                tagName !== "body") ||
              hasJsxSpreadAttribute(openingElement.attributes) ||
              ["hidden", "aria-hidden", "inert", "is"].some((attributeName) =>
                hasJsxPropIgnoreCase(openingElement.attributes, attributeName),
              ) ||
              (openingElement !== node && hasJsxPropIgnoreCase(openingElement.attributes, "role"))
            ) {
              return;
            }
          }
          ancestor = ancestor.parent;
        }

        if (!isRegionReachable(node)) return;
        if (isInsideStaticallyHiddenJsxSubtree(node, context)) return;

        context.report({
          node: roleAttribute,
          message:
            "This explicit region has no naming attribute. Add aria-label or aria-labelledby referencing a visible heading so the region can be identified when exposed.",
        });
      },
    };
  },
});
