import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const GRAY_TEXT_PATTERN = /^text-(?:gray|slate|zinc|neutral|stone)-[4-9]00\b/;
const COLORED_BG_PATTERN =
  /^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[5-9]00|950)\b/;

// The variant prefix of a Tailwind token is everything before the final
// `:` (`dark:hover:text-gray-500` → `dark:hover`); the utility itself is
// the remainder. A gray-text token and a colored-bg token only render
// simultaneously when they share the same variant scope — `bg-white
// text-gray-500 dark:bg-blue-600 dark:text-white` never shows gray text
// on the colored background, so it must not fire.
const splitVariantScope = (token: string): { scope: string; utility: string } => {
  const lastColonIndex = token.lastIndexOf(":");
  if (lastColonIndex === -1) return { scope: "", utility: token };
  return { scope: token.slice(0, lastColonIndex), utility: token.slice(lastColonIndex + 1) };
};

export const noGrayOnColoredBackground = defineRule({
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

      const grayTextByScope = new Map<string, string>();
      const coloredBgByScope = new Map<string, string>();
      for (const token of classStr.split(/\s+/)) {
        if (!token) continue;
        const { scope, utility } = splitVariantScope(token);
        const grayMatch = utility.match(GRAY_TEXT_PATTERN);
        if (grayMatch && !grayTextByScope.has(scope)) grayTextByScope.set(scope, grayMatch[0]);
        const coloredMatch = utility.match(COLORED_BG_PATTERN);
        if (coloredMatch && !coloredBgByScope.has(scope))
          coloredBgByScope.set(scope, coloredMatch[0]);
      }

      for (const [scope, grayUtility] of grayTextByScope) {
        const coloredUtility = coloredBgByScope.get(scope);
        if (!coloredUtility) continue;
        context.report({
          node,
          message: `Your users see washed-out gray text (${grayUtility}) on a colored background (${coloredUtility}), so use white or a darker shade of the background color.`,
        });
        return;
      }
    },
  }),
});
