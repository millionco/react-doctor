import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getStaticSrcsetDescriptorKinds } from "../../utils/get-static-srcset-descriptor-kinds.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const hasMixedDescriptors = (sourceSet: string): boolean => {
  const descriptorKinds = getStaticSrcsetDescriptorKinds(sourceSet);
  return descriptorKinds !== null && descriptorKinds.size > 1;
};

export const noMixedSrcsetDescriptors = defineRule({
  id: "no-mixed-srcset-descriptors",
  title: "srcSet mixes width and density descriptors",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Use either width descriptors with sizes or density descriptors throughout one srcSet, never both.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "img" || hasJsxSpreadAttribute(node.attributes)) return;
      const sourceSetAttribute = findJsxAttribute(node.attributes, "srcSet");
      const sourceSet = sourceSetAttribute
        ? getStringLiteralAttributeValue(sourceSetAttribute)
        : null;
      if (!sourceSetAttribute || !sourceSet || !hasMixedDescriptors(sourceSet)) return;
      context.report({
        node: sourceSetAttribute,
        message:
          "This srcSet mixes width and pixel-density descriptors, which is invalid candidate syntax. Use one descriptor family consistently.",
      });
    },
  }),
});
