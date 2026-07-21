import { defineRule } from "../../utils/define-rule.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { getTailwindTopLevelCharacterIndices } from "../../utils/get-tailwind-top-level-character-indices.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const GRAY_TEXT_PATTERN = /^text-(?:gray|slate|zinc|neutral|stone)-(?:[4-9]00|950)\b/;
const COLORED_BG_PATTERN =
  /^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[5-9]00|950)\b/;

const TEXT_COLOR_PATTERN =
  /^text-(?:white|black|transparent|current|inherit|\[|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-)/;
const BG_COLOR_PATTERN =
  /^bg-(?:white|black|transparent|current|inherit|\[|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-)/;

// Washed-out gray needs the text and background to sit close in
// luminance. Polar-opposite shades (`text-gray-400` on `bg-blue-950`
// muted-on-dark cards, `text-gray-900` on `bg-yellow-500` warning
// badges) are deliberate high-contrast pairings.
const WASHED_OUT_SHADE_GAP_MAX = 400;

// At -500, these hues are bright enough that near-black gray text is
// the recommended contrast choice, not a washout.
const LIGHT_BG_HUES = new Set(["yellow", "amber", "lime"]);
const LIGHT_BG_DARK_GRAY_MIN_SHADE = 700;

const splitTailwindOpacityModifier = (utility: string): [string, string | null] => {
  const modifierIndex = getTailwindTopLevelCharacterIndices(
    utility,
    (character) => character === "/",
  )[0];
  return modifierIndex === undefined
    ? [utility, null]
    : [utility.slice(0, modifierIndex), utility.slice(modifierIndex + 1)];
};

const hasOpaqueTailwindColorModifier = (utility: string): boolean => {
  const [, modifier] = splitTailwindOpacityModifier(utility);
  if (modifier === null || modifier === "100") return true;
  const arbitraryValue = /^\[([\d.]+)%?\]$/.exec(modifier)?.[1];
  if (!arbitraryValue) return false;
  const opacity = Number.parseFloat(arbitraryValue);
  return modifier.endsWith("%]") ? opacity === 100 : opacity === 1;
};

const getUtilityShade = (utility: string): number | null => {
  const [utilityWithoutModifier] = splitTailwindOpacityModifier(utility);
  const shadeMatch = utilityWithoutModifier.match(/-(\d+)$/);
  return shadeMatch ? Number(shadeMatch[1]) : null;
};

const isWashedOutPair = (grayUtility: string, coloredUtility: string): boolean => {
  const grayShade = getUtilityShade(grayUtility);
  const bgShade = getUtilityShade(coloredUtility);
  if (grayShade === null || bgShade === null) return true;
  if (Math.abs(grayShade - bgShade) > WASHED_OUT_SHADE_GAP_MAX) return false;
  const hueMatch = coloredUtility.match(/^bg-([a-z]+)-/);
  if (
    hueMatch &&
    LIGHT_BG_HUES.has(hueMatch[1]) &&
    bgShade <= 500 &&
    grayShade >= LIGHT_BG_DARK_GRAY_MIN_SHADE
  ) {
    return false;
  }
  return true;
};

const addScopedUtility = (
  utilitiesByScope: Map<string, string[]>,
  scope: string,
  utility: string,
  isImportant: boolean,
): void => {
  const utilities = utilitiesByScope.get(scope) ?? [];
  utilities.push(isImportant ? `!${utility}` : utility);
  utilitiesByScope.set(scope, utilities);
};

const getEffectiveScopedUtility = (
  utilitiesByScope: Map<string, string[]>,
  scope: string,
): string | null =>
  getEffectiveTailwindClassNameToken(utilitiesByScope.get(scope) ?? [], () => true);

export const noGrayOnColoredBackground = defineRule({
  id: "no-gray-on-colored-background",
  title: "Gray text on colored background",
  tags: ["test-noise"],
  requires: ["tailwind"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use white or near-white text, or a darker shade of the background color. Gray text on colored backgrounds looks washed out.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isProvenIntrinsicJsxElement(node, context.scopes)) return;
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      const textColorsByScope = new Map<string, string[]>();
      const backgroundColorsByScope = new Map<string, string[]>();
      for (const token of splitTailwindClassName(classStr)) {
        const parsedToken = parseTailwindClassNameToken(token);
        const scope = [...parsedToken.variants].sort().join(":");
        if (TEXT_COLOR_PATTERN.test(parsedToken.utility)) {
          addScopedUtility(textColorsByScope, scope, parsedToken.utility, parsedToken.isImportant);
        }
        if (BG_COLOR_PATTERN.test(parsedToken.utility)) {
          addScopedUtility(
            backgroundColorsByScope,
            scope,
            parsedToken.utility,
            parsedToken.isImportant,
          );
        }
      }

      const reportPair = (grayUtility: string, coloredUtility: string): void => {
        context.report({
          node,
          message: `Your users see washed-out gray text (${grayUtility}) on a colored background (${coloredUtility}), so use white or a darker shade of the background color.`,
        });
      };

      for (const scope of textColorsByScope.keys()) {
        const grayUtility = getEffectiveScopedUtility(textColorsByScope, scope);
        const coloredUtility = getEffectiveScopedUtility(backgroundColorsByScope, scope);
        if (
          !grayUtility ||
          !coloredUtility ||
          !GRAY_TEXT_PATTERN.test(grayUtility) ||
          !COLORED_BG_PATTERN.test(coloredUtility) ||
          !hasOpaqueTailwindColorModifier(coloredUtility)
        ) {
          continue;
        }
        if (!isWashedOutPair(grayUtility, coloredUtility)) continue;
        reportPair(grayUtility, coloredUtility);
        return;
      }

      // Variants are additive: a base-scope utility still applies under a
      // variant unless that scope overrides the same property, so base
      // gray text pairs with `dark:bg-blue-600` when there is no
      // `dark:text-*`, and vice versa.
      const baseGrayText = getEffectiveScopedUtility(textColorsByScope, "");
      if (baseGrayText && GRAY_TEXT_PATTERN.test(baseGrayText)) {
        for (const scope of backgroundColorsByScope.keys()) {
          if (scope === "" || textColorsByScope.has(scope)) continue;
          const coloredUtility = getEffectiveScopedUtility(backgroundColorsByScope, scope);
          if (
            !coloredUtility ||
            !COLORED_BG_PATTERN.test(coloredUtility) ||
            !hasOpaqueTailwindColorModifier(coloredUtility)
          ) {
            continue;
          }
          if (!isWashedOutPair(baseGrayText, coloredUtility)) continue;
          reportPair(baseGrayText, coloredUtility);
          return;
        }
      }
      const baseColoredBg = getEffectiveScopedUtility(backgroundColorsByScope, "");
      if (
        baseColoredBg &&
        COLORED_BG_PATTERN.test(baseColoredBg) &&
        hasOpaqueTailwindColorModifier(baseColoredBg)
      ) {
        for (const scope of textColorsByScope.keys()) {
          if (scope === "" || backgroundColorsByScope.has(scope)) continue;
          const grayUtility = getEffectiveScopedUtility(textColorsByScope, scope);
          if (!grayUtility || !GRAY_TEXT_PATTERN.test(grayUtility)) continue;
          if (!isWashedOutPair(grayUtility, baseColoredBg)) continue;
          reportPair(grayUtility, baseColoredBg);
          return;
        }
      }
    },
  }),
});
