import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const GRAY_TEXT_PATTERN = /^text-(?:gray|slate|zinc|neutral|stone)-(?:[4-9]00|950)\b/;
const COLORED_BG_PATTERN =
  /^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[5-9]00|950)\b/;

const TEXT_COLOR_PATTERN =
  /^text-(?:white|black|transparent|current|inherit|\[|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-)/;
const BG_COLOR_PATTERN =
  /^bg-(?:white|black|transparent|current|inherit|\[|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-)/;

// The variant scope of a Tailwind token is every segment before the
// utility (`dark:hover:text-gray-500` → `dark:hover`), sorted so
// reordered stacks (`md:hover` vs `hover:md`) share one key. A leading
// `!` (the important modifier) is not part of the utility name.
const splitVariantScope = (token: string): { scope: string; utility: string } => {
  if (!token.includes(":")) {
    return { scope: "", utility: token.startsWith("!") ? token.slice(1) : token };
  }
  const segments = token.split(":");
  const rawUtility = segments[segments.length - 1];
  return {
    scope: segments.slice(0, -1).sort().join(":"),
    utility: rawUtility.startsWith("!") ? rawUtility.slice(1) : rawUtility,
  };
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
      const textColorScopes = new Set<string>();
      const bgColorScopes = new Set<string>();
      for (const token of classStr.split(/\s+/)) {
        if (!token) continue;
        // Every pattern below anchors on a `text-` / `bg-` utility, so a
        // token containing neither substring can never match — skip the
        // variant-scope split and the four regexes.
        if (!token.includes("text-") && !token.includes("bg-")) continue;
        const { scope, utility } = splitVariantScope(token);
        if (TEXT_COLOR_PATTERN.test(utility)) textColorScopes.add(scope);
        if (BG_COLOR_PATTERN.test(utility)) bgColorScopes.add(scope);
        const grayMatch = utility.match(GRAY_TEXT_PATTERN);
        if (grayMatch && !grayTextByScope.has(scope)) grayTextByScope.set(scope, grayMatch[0]);
        const coloredMatch = utility.match(COLORED_BG_PATTERN);
        if (coloredMatch && !coloredBgByScope.has(scope))
          coloredBgByScope.set(scope, coloredMatch[0]);
      }

      const reportPair = (grayUtility: string, coloredUtility: string): void => {
        context.report({
          node,
          message: `Your users see washed-out gray text (${grayUtility}) on a colored background (${coloredUtility}), so use white or a darker shade of the background color.`,
        });
      };

      for (const [scope, grayUtility] of grayTextByScope) {
        const coloredUtility = coloredBgByScope.get(scope);
        if (!coloredUtility) continue;
        reportPair(grayUtility, coloredUtility);
        return;
      }

      // Variants are additive: a base-scope utility still applies under a
      // variant unless that scope overrides the same property, so base
      // gray text pairs with `dark:bg-blue-600` when there is no
      // `dark:text-*`, and vice versa.
      const baseGrayText = grayTextByScope.get("");
      if (baseGrayText) {
        for (const [scope, coloredUtility] of coloredBgByScope) {
          if (scope === "" || textColorScopes.has(scope)) continue;
          reportPair(baseGrayText, coloredUtility);
          return;
        }
      }
      const baseColoredBg = coloredBgByScope.get("");
      if (baseColoredBg) {
        for (const [scope, grayUtility] of grayTextByScope) {
          if (scope === "" || bgColorScopes.has(scope)) continue;
          reportPair(grayUtility, baseColoredBg);
          return;
        }
      }
    },
  }),
});
