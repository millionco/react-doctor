import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticSrcsetDescriptorKinds } from "../../utils/get-static-srcset-descriptor-kinds.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noSrcsetWithoutSizes = defineRule({
  id: "no-srcset-without-sizes",
  title: "Responsive image omits sizes",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Add a sizes attribute that describes the image's rendered width at each responsive breakpoint.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "img" || hasJsxSpreadAttribute(node.attributes)) return;
      const sourceSetAttribute = findJsxAttribute(node.attributes, "srcSet");
      if (!sourceSetAttribute || findJsxAttribute(node.attributes, "sizes")) return;
      const sourceSet = getStringLiteralAttributeValue(sourceSetAttribute);
      const descriptorKinds = sourceSet ? getStaticSrcsetDescriptorKinds(sourceSet) : null;
      if (!descriptorKinds?.has("width")) return;
      context.report({
        node: sourceSetAttribute,
        message:
          "This responsive image supplies srcSet without sizes, so the browser assumes a 100vw slot and may download an unnecessarily large candidate. Describe its actual responsive width with sizes.",
      });
    },
  }),
});
