import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { hasJsxAttribute } from "../../utils/has-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `fill` controls whether the image fills its parent (and so needs `sizes`).
// Bare `<Image fill>` and `fill={true}` are active; `fill={false}` turns it
// off, so `sizes` is irrelevant. A non-literal expression (`fill={cond}`) is
// treated as possibly-active to avoid silencing genuine fill usage.
const isFillActive = (attributes: EsTreeNode[]): boolean => {
  const fillAttribute = findJsxAttribute(attributes, "fill");
  if (!fillAttribute) return false;
  const value = fillAttribute.value;
  if (!value) return true;
  if (isNodeOfType(value, "JSXExpressionContainer") && isNodeOfType(value.expression, "Literal")) {
    return value.expression.value !== false;
  }
  return true;
};

export const nextjsImageMissingSizes = defineRule({
  id: "nextjs-image-missing-sizes",
  title: "next/image fill image is missing sizes",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Add `sizes` matching your layout so `next/image` does not assume the largest candidate and make users download oversized images.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "Image") return;
      const attributes = node.attributes ?? [];
      if (hasJsxSpreadAttribute(attributes)) return;
      if (!isFillActive(attributes)) return;
      if (hasJsxAttribute(attributes, "sizes")) return;

      context.report({
        node,
        message: "next/image uses fill without sizes, so your users download the largest image.",
      });
    },
  }),
});
