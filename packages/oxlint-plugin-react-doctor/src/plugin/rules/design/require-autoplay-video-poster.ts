import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isStaticallyEnabled = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return true;
  const expression = isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value;
  return isNodeOfType(expression, "Literal") && expression.value === true;
};

export const requireAutoplayVideoPoster = defineRule({
  id: "require-autoplay-video-poster",
  title: "Autoplay video has no poster frame",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Provide a representative `poster` image so the video region is intentional before playback begins and while media is unavailable.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "video") return;
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const autoPlayAttribute = hasJsxPropIgnoreCase(node.attributes, "autoplay");
      if (!autoPlayAttribute || !isStaticallyEnabled(autoPlayAttribute)) return;
      if (hasJsxPropIgnoreCase(node.attributes, "poster")) return;
      context.report({
        node: node.name,
        message:
          "This autoplaying video has no poster frame, so users can see an empty or unstable media region before playback. Add a representative poster image.",
      });
    },
  }),
});
