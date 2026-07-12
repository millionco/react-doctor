import { MOTION_ANIMATE_PROPS } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

export const renderingAnimateSvgWrapper = defineRule({
  id: "rendering-animate-svg-wrapper",
  title: "Animating an SVG directly",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Wrap the SVG in a motion element so animation props apply to a stable wrapper instead of the SVG node itself.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "svg") return;

      const hasAnimationProp = node.attributes?.some(
        (attribute: EsTreeNode) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          MOTION_ANIMATE_PROPS.has(attribute.name.name),
      );

      if (hasAnimationProp) {
        context.report({
          node,
          message:
            "This is slow to render because you animate <svg> directly, so wrap it in a <div> or <motion.div> & animate that instead",
        });
      }
    },
  }),
});
