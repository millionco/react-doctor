import { defineRule } from "../../utils/define-rule.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const INVALID_IMAGE_SOURCES = new Set(["", "#"]);

export const noBrokenImageSource = defineRule({
  id: "no-broken-image-source",
  title: "Image has no usable source",
  tags: ["test-noise"],
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Provide a real image URL or remove the image element until an asset is available.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "img") return;
      if (hasJsxPropIgnoreCase(node.attributes, "ref")) return;
      const sourceAttribute = hasJsxPropIgnoreCase(node.attributes, "src");
      if (!sourceAttribute) {
        if (hasJsxSpreadAttribute(node.attributes)) return;
        context.report({
          node,
          message:
            "This image has no source and will render as a broken placeholder. Supply an asset or remove the element.",
        });
        return;
      }
      if (sourceAttribute.value === null) {
        context.report({
          node: sourceAttribute,
          message: "This image source is empty, so the browser cannot load an image.",
        });
        return;
      }
      const sourceValue = getStringLiteralAttributeValue(sourceAttribute);
      if (sourceValue === null || !INVALID_IMAGE_SOURCES.has(sourceValue.trim())) return;
      context.report({
        node: sourceAttribute,
        message:
          "This placeholder source does not identify an image. Use a real asset URL or remove the image element.",
      });
    },
  }),
});
