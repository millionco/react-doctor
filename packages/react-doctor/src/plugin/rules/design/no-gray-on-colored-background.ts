import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGrayOnColoredBackground = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use a darker shade of the background color for text, or white/near-white for contrast. Gray text on colored backgrounds looks washed out",
  examples: [
    {
      before: '<div className="bg-blue-600 text-gray-400">Highlighted</div>',
      after: '<div className="bg-blue-600 text-white">Highlighted</div>',
    },
  ],
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
          message: `Gray text (${grayTextMatch[0]}) on colored background (${coloredBgMatch[0]}) looks washed out — use a darker shade of the background color or white`,
        });
      }
    },
  }),
});
