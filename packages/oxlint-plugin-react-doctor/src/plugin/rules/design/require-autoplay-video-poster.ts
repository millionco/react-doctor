import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isStaticallyEnabled = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value: EsTreeNode | null = attribute.value;
  if (!value) return true;
  const expression = isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value;
  return (
    isNodeOfType(expression, "Literal") &&
    (expression.value === true || expression.value === "true")
  );
};

const hasUsablePoster = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const posterAttribute = hasJsxPropIgnoreCase(node.attributes, "poster");
  if (!posterAttribute) return false;
  const staticPoster = getStringLiteralAttributeValue(posterAttribute);
  return staticPoster === null || staticPoster.trim().length > 0;
};

const hasDeclarativeVideoSource = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (hasJsxPropIgnoreCase(node.attributes, "src")) return true;
  const element = node.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  return element.children.some(
    (child) =>
      isNodeOfType(child, "JSXElement") &&
      isNodeOfType(child.openingElement.name, "JSXIdentifier") &&
      child.openingElement.name.name === "source",
  );
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
      if (!hasDeclarativeVideoSource(node)) return;
      if (hasUsablePoster(node)) return;
      context.report({
        node: node.name,
        message:
          "This autoplaying video has no poster frame, so users can see an empty or unstable media region before playback. Add a representative poster image.",
      });
    },
  }),
});
