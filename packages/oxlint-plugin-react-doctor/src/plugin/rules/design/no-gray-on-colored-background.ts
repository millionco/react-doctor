import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGrayOnColoredBackground = defineRule<Rule>({
  id: "no-gray-on-colored-background",
  title: "Gray text on colored background",
  tags: ["test-noise"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use white or near-white text, or a darker shade of the background color. Gray text on colored backgrounds looks washed out.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      const grayTextMatch = classStr.match(/\btext-(?:gray|slate|zinc|neutral|stone)-\d+\b/);
      const coloredBgMatch = classStr.match(
        /\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/,
      );

      if (grayTextMatch && coloredBgMatch) {
        context.report({
          node,
          message: `Your users see washed-out gray text (${grayTextMatch[0]}) on a colored background (${coloredBgMatch[0]}), so use white or a darker shade of the background color.`,
        });
      }
    },
  }),
});
