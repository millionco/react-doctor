import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const isStaticallyEnabled = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value !== false;
  if (
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal")
  ) {
    return attribute.value.expression.value !== false;
  }
  return false;
};

export const noServerSideImageMap = defineRule({
  id: "no-server-side-image-map",
  title: "Server-side image map",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Replace isMap with semantic links or a client-side map that exposes each target.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "img") return;
      const isMapAttribute = getAuthoritativeJsxAttribute(node.attributes, "isMap", false);
      if (!isMapAttribute || !isStaticallyEnabled(isMapAttribute)) return;
      context.report({
        node: isMapAttribute,
        message:
          "Server-side image maps require pointer coordinates and do not expose individual targets to keyboard or assistive-technology users. Replace this isMap image with semantic links.",
      });
    },
  }),
});
