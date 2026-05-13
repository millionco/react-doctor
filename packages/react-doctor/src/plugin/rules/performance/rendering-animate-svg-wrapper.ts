import { MOTION_ANIMATE_PROPS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const renderingAnimateSvgWrapper = defineRule<Rule>({
  recommendation: "Wrap the SVG: `<motion.div animate={...}><svg>...</svg></motion.div>`",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "svg") return;

      const hasAnimationProp = node.attributes?.some(
        (attribute: EsTreeNode) =>
          attribute.type === "JSXAttribute" &&
          attribute.name?.type === "JSXIdentifier" &&
          MOTION_ANIMATE_PROPS.has(attribute.name.name),
      );

      if (hasAnimationProp) {
        context.report({
          node,
          message:
            "Animation props directly on <svg> — wrap in a <div> or <motion.div> for better rendering performance",
        });
      }
    },
  }),
});
