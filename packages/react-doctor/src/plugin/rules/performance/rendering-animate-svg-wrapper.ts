import { MOTION_ANIMATE_PROPS } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const renderingAnimateSvgWrapper = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation: "Wrap the SVG: `<motion.div animate={...}><svg>...</svg></motion.div>`",
  examples: [
    {
      before: "<svg animate={{ rotate: 360 }}><circle r={10} /></svg>",
      after: "<motion.div animate={{ rotate: 360 }}><svg><circle r={10} /></svg></motion.div>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "svg") return;

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
            "Animation props directly on <svg> — wrap in a <div> or <motion.div> for better rendering performance",
        });
      }
    },
  }),
});
