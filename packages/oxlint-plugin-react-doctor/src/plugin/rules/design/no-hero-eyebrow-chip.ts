import {
  HERO_EYEBROW_DASH_MAX_HEIGHT_PX,
  HERO_EYEBROW_DASH_MAX_WIDTH_PX,
  HERO_EYEBROW_DASH_MIN_HEIGHT_PX,
  HERO_EYEBROW_DASH_MIN_WIDTH_PX,
  HERO_EYEBROW_LABEL_MAX_FONT_SIZE_PX,
  SHORT_DECORATIVE_LABEL_MAX_CHARACTERS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getNextStaticJsxElementSibling } from "../../utils/get-next-static-jsx-element-sibling.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStaticTailwindFontSize } from "./utils/get-static-tailwind-font-size.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { hasVisibleTailwindFillOrEdge } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { parseStaticTailwindFontSize } from "./utils/parse-static-tailwind-font-size.js";
import { parseStaticTailwindLengthPx } from "./utils/parse-static-tailwind-length-px.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";

const HERO_HEADING_SIZE_CLASSES = new Set([
  "text-5xl",
  "text-6xl",
  "text-7xl",
  "text-8xl",
  "text-9xl",
]);

const PSEUDO_ELEMENT_NAMES = ["before", "after"];
const PSEUDO_DISPLAY_UTILITIES = new Set(["block", "inline-block"]);
const PSEUDO_CONTENT_PATTERN = /^(?:content-\[(?:""|'')\]|\[content:(?:""|'')\])$/;
const TAILWIND_BACKGROUND_COLOR_PATTERN =
  /^bg-(?:transparent|black|white|current|inherit|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|\[(?!url\(|(?:image|length|position|size):).+\])(?:\/.+)?$/;
const CHROMATIC_TAILWIND_BACKGROUND_PATTERN =
  /^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/;
const TEXT_TRANSFORM_UTILITIES = new Set(["capitalize", "lowercase", "normal-case", "uppercase"]);
const BASE_ROUNDING_PATTERN = /^rounded(?:$|-(?!(?:b|bl|br|e|ee|es|l|r|s|se|ss|t|tl|tr)-))/;
const HORIZONTAL_PADDING_PATTERN = /^p(?:x)?-/;
const STATIC_ARBITRARY_TRACKING_PATTERN =
  /^tracking-\[(?:length:)?(-?(?:\d+(?:\.\d*)?|\.\d+))(?:em|px|rem)\]$/i;

const hasPositivePillPadding = (token: string): boolean => {
  const spacingMatch = token.match(/^p(?:x)?-(px|[\d.]+)$/);
  if (spacingMatch) return spacingMatch[1] === "px" || parseFloat(spacingMatch[1]) > 0;
  const arbitraryMatch = token.match(/^p(?:x)?-\[([\d.]+)(?:px|rem)\]$/);
  return Boolean(arbitraryMatch && parseFloat(arbitraryMatch[1]) > 0);
};

const isNonNormalTrackingUtility = (utility: string): boolean => {
  if (utility === "tracking-normal") return false;
  if (/^tracking-(?:tight|tighter|wide|wider|widest)$/.test(utility)) return true;
  const arbitraryTracking = utility.match(STATIC_ARBITRARY_TRACKING_PATTERN);
  return Boolean(arbitraryTracking && Number.parseFloat(arbitraryTracking[1]) !== 0);
};

const hasChromaticTailwindBackground = (utility: string): boolean => {
  if (CHROMATIC_TAILWIND_BACKGROUND_PATTERN.test(utility)) return true;
  const arbitraryColor = utility.match(/^bg-\[(?:color:)?(.+)\]$/)?.[1];
  if (!arbitraryColor || /^(?:rgba|hsla)\(/i.test(arbitraryColor)) return false;
  if (/^#[\da-f]{4}(?:[\da-f]{4})?$/i.test(arbitraryColor)) return false;
  const parsedColor = parseColorToRgb(arbitraryColor);
  return parsedColor ? hasColorChroma(parsedColor) : false;
};

const hasStaticDashPseudoElement = (classNameValue: string): boolean => {
  const utilitiesByPseudoElement = new Map<string, string[]>(
    PSEUDO_ELEMENT_NAMES.map((pseudoElementName) => [pseudoElementName, []]),
  );
  for (const rawToken of splitTailwindClassName(classNameValue)) {
    const parsedToken = parseTailwindClassNameToken(rawToken);
    if (
      parsedToken.variants.length !== 1 ||
      !PSEUDO_ELEMENT_NAMES.includes(parsedToken.variants[0])
    ) {
      continue;
    }
    const utilities = utilitiesByPseudoElement.get(parsedToken.variants[0]);
    utilities?.push(parsedToken.isImportant ? `!${parsedToken.utility}` : parsedToken.utility);
  }

  for (const utilities of utilitiesByPseudoElement.values()) {
    const contentResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => utility.startsWith("content-") || utility.startsWith("[content:"),
      [],
    );
    const displayResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) =>
        PSEUDO_DISPLAY_UTILITIES.has(utility) ||
        ["hidden", "contents", "flex", "grid", "inline", "inline-flex", "inline-grid"].includes(
          utility,
        ),
      [],
    );
    const widthResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => utility.startsWith("w-"),
      [],
    );
    const heightResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => utility.startsWith("h-"),
      [],
    );
    const backgroundResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => TAILWIND_BACKGROUND_COLOR_PATTERN.test(utility),
      [],
    );
    const backgroundOpacityResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => utility.startsWith("bg-opacity-"),
      [],
    );
    if (
      contentResolution.isAmbiguous ||
      displayResolution.isAmbiguous ||
      widthResolution.isAmbiguous ||
      heightResolution.isAmbiguous ||
      backgroundResolution.isAmbiguous ||
      backgroundOpacityResolution.isAmbiguous ||
      !contentResolution.utility ||
      !PSEUDO_CONTENT_PATTERN.test(contentResolution.utility) ||
      !displayResolution.utility ||
      !PSEUDO_DISPLAY_UTILITIES.has(displayResolution.utility) ||
      !widthResolution.utility ||
      !heightResolution.utility ||
      !backgroundResolution.utility ||
      !hasChromaticTailwindBackground(backgroundResolution.utility) ||
      (backgroundOpacityResolution.utility &&
        backgroundOpacityResolution.utility !== "bg-opacity-100")
    ) {
      continue;
    }

    const widthPx = parseStaticTailwindLengthPx(widthResolution.utility, "w");
    const heightPx = parseStaticTailwindLengthPx(heightResolution.utility, "h");
    if (
      widthPx !== null &&
      widthPx >= HERO_EYEBROW_DASH_MIN_WIDTH_PX &&
      widthPx <= HERO_EYEBROW_DASH_MAX_WIDTH_PX &&
      heightPx !== null &&
      heightPx >= HERO_EYEBROW_DASH_MIN_HEIGHT_PX &&
      heightPx <= HERO_EYEBROW_DASH_MAX_HEIGHT_PX
    ) {
      return true;
    }
  }
  return false;
};

export const noHeroEyebrowChip = defineRule({
  id: "no-hero-eyebrow-chip",
  title: "Hero uses a decorative eyebrow label",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Integrate the context into the headline or navigation instead of adding a generic chip above the hero title.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const labelText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (!labelText || labelText.length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS) return;
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const labelTokens = getUnvariantClassNameTokensWithImportantModifiers(classNameValue);
      const effectiveTextTransform = getEffectiveTailwindClassNameToken(labelTokens, (utility) =>
        TEXT_TRANSFORM_UTILITIES.has(utility),
      );
      const effectiveTracking = getEffectiveTailwindClassNameToken(labelTokens, (utility) =>
        utility.startsWith("tracking-"),
      );
      const isTrackedLabel =
        effectiveTextTransform === "uppercase" &&
        effectiveTracking !== null &&
        isNonNormalTrackingUtility(effectiveTracking);
      const effectiveRounding = getEffectiveTailwindClassNameToken(labelTokens, (utility) =>
        BASE_ROUNDING_PATTERN.test(utility),
      );
      const effectiveHorizontalPadding = getEffectiveTailwindClassNameToken(
        labelTokens,
        (utility) => HORIZONTAL_PADDING_PATTERN.test(utility),
      );
      const isPillLabel =
        effectiveRounding === "rounded-full" &&
        hasVisibleTailwindFillOrEdge(labelTokens) &&
        effectiveHorizontalPadding !== null &&
        hasPositivePillPadding(effectiveHorizontalPadding);
      const labelFontSizePx = getStaticTailwindFontSize(classNameValue);
      const hasDashPseudoElement =
        labelFontSizePx !== null &&
        labelFontSizePx <= HERO_EYEBROW_LABEL_MAX_FONT_SIZE_PX &&
        hasStaticDashPseudoElement(classNameValue);
      if (!isTrackedLabel && !isPillLabel && !hasDashPseudoElement) return;

      const heading = getNextStaticJsxElementSibling(node);
      if (
        !heading ||
        !isNodeOfType(heading.openingElement.name, "JSXIdentifier") ||
        heading.openingElement.name.name !== "h1"
      ) {
        return;
      }
      const headingClassName = getStringFromClassNameAttr(heading.openingElement);
      const headingTokens = headingClassName
        ? getUnvariantClassNameTokensWithImportantModifiers(headingClassName)
        : [];
      const effectiveHeadingSize = getEffectiveTailwindClassNameToken(
        headingTokens,
        (utility) => parseStaticTailwindFontSize(utility) !== null,
      );
      if (!effectiveHeadingSize || !HERO_HEADING_SIZE_CLASSES.has(effectiveHeadingSize)) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This small decorative label immediately above a display headline creates a generic hero scaffold. Fold the context into stronger content structure.",
      });
    },
  }),
});
