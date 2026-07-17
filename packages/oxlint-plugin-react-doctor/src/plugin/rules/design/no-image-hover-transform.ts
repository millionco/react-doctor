import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const HOVER_IMAGE_TRANSFORM_PATTERN = /^(?:group-)?hover:(?:scale-|rotate-)/;

export const noImageHoverTransform = defineRule({
  id: "no-image-hover-transform",
  title: "Image scales or rotates on hover",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Keep the image stable, or use a subtler hover response tied to an actual interaction affordance.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "img") return;
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const hoverTransform = classNameValue
        .split(/\s+/)
        .find((token) => HOVER_IMAGE_TRANSFORM_PATTERN.test(token));
      if (!hoverTransform) return;
      context.report({
        node,
        message: `The ${hoverTransform} treatment makes the image itself shift under the pointer. Use a steadier hover affordance.`,
      });
    },
  }),
});
