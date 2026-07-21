import { ROOT_FONT_SIZE_PX, TAILWIND_SPACING_UNIT_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { parseStaticTailwindFontSize } from "./utils/parse-static-tailwind-font-size.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";

interface LayoutPropertyDeclaration {
  property: string;
  value: number | string | null;
}

interface ParsedClassNameToken {
  isImportant: boolean;
  rawToken: string;
  utility: string;
  variants: string[];
}

const INTERACTION_VARIANTS = new Set(["active", "focus", "focus-visible", "hover"]);
const FONT_WEIGHT_UTILITIES = new Set([
  "font-black",
  "font-bold",
  "font-extrabold",
  "font-extralight",
  "font-light",
  "font-medium",
  "font-normal",
  "font-semibold",
  "font-thin",
]);
const SPACING_PROPERTIES = new Map<string, string[]>([
  ["m", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
  ["mx", ["margin-right", "margin-left"]],
  ["my", ["margin-top", "margin-bottom"]],
  ["mt", ["margin-top"]],
  ["mr", ["margin-right"]],
  ["mb", ["margin-bottom"]],
  ["ml", ["margin-left"]],
  ["ms", ["margin-inline-start"]],
  ["me", ["margin-inline-end"]],
  ["p", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
  ["px", ["padding-right", "padding-left"]],
  ["py", ["padding-top", "padding-bottom"]],
  ["pt", ["padding-top"]],
  ["pr", ["padding-right"]],
  ["pb", ["padding-bottom"]],
  ["pl", ["padding-left"]],
  ["ps", ["padding-inline-start"]],
  ["pe", ["padding-inline-end"]],
]);
const SIZE_PROPERTIES = new Map<string, string[]>([
  ["w", ["width"]],
  ["h", ["height"]],
  ["size", ["width", "height"]],
  ["min-w", ["min-width"]],
  ["min-h", ["min-height"]],
  ["max-w", ["max-width"]],
  ["max-h", ["max-height"]],
  ["basis", ["flex-basis"]],
]);
const STATIC_LENGTH_PATTERN =
  /^(-?(?:\d+(?:\.\d*)?|\.\d+))(cap|ch|cqb|cqh|cqi|cqmax|cqmin|cqw|em|ex|ic|lh|px|rem|rlh|vb|vh|vi|vmax|vmin|vw|%)$/i;

const hasInteractionVariant = (variants: ReadonlyArray<string>): boolean =>
  variants.some((variant) => INTERACTION_VARIANTS.has(variant));

const parseStaticArbitraryLength = (value: string): number | string | null => {
  const arbitraryValue = value.match(/^\[(?:length:)?(.+)\]$/)?.[1];
  if (!arbitraryValue) return null;
  const lengthMatch = arbitraryValue.match(STATIC_LENGTH_PATTERN);
  if (!lengthMatch) return null;
  const numericValue = Number.parseFloat(lengthMatch[1]);
  const unit = lengthMatch[2].toLowerCase();
  if (unit === "px") return numericValue;
  if (unit === "rem") return numericValue * ROOT_FONT_SIZE_PX;
  return `${numericValue}${unit}`;
};

const parseSpacingValue = (value: string, isNegative: boolean): number | string | null => {
  const sign = isNegative ? -1 : 1;
  if (value === "px") return sign;
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return sign * Number.parseFloat(value) * TAILWIND_SPACING_UNIT_PX;
  }
  const arbitraryLength = parseStaticArbitraryLength(value);
  if (typeof arbitraryLength === "number") return sign * arbitraryLength;
  if (typeof arbitraryLength === "string") return `${isNegative ? "-" : ""}${arbitraryLength}`;
  return value.startsWith("[") ? null : `${isNegative ? "-" : ""}${value}`;
};

const parseFlexFactor = (value: string): number | string | null => {
  const arbitraryValue = value.match(/^\[(-?(?:\d+(?:\.\d*)?|\.\d+))\]$/)?.[1];
  if (arbitraryValue) return Number.parseFloat(arbitraryValue);
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number.parseFloat(value);
  return value.startsWith("[") ? null : value;
};

const getLayoutPropertyDeclarations = (utility: string): LayoutPropertyDeclaration[] => {
  const isNegative = utility.startsWith("-");
  const unsignedUtility = isNegative ? utility.slice(1) : utility;
  const spacingMatch = unsignedUtility.match(/^([mp](?:[trblxyse])?)-(.+)$/);
  if (spacingMatch) {
    const properties = SPACING_PROPERTIES.get(spacingMatch[1]);
    if (!properties) return [];
    const value = parseSpacingValue(spacingMatch[2], isNegative);
    return properties.map((property) => ({ property, value }));
  }

  const gapMatch = unsignedUtility.match(/^gap(?:-([xy]))?-(.+)$/);
  if (gapMatch) {
    const properties =
      gapMatch[1] === "x"
        ? ["column-gap"]
        : gapMatch[1] === "y"
          ? ["row-gap"]
          : ["row-gap", "column-gap"];
    const value = parseSpacingValue(gapMatch[2], false);
    return properties.map((property) => ({ property, value }));
  }

  const spaceMatch = unsignedUtility.match(/^space-([xy])-(.+)$/);
  if (spaceMatch) {
    return [
      {
        property: spaceMatch[1] === "x" ? "space-x" : "space-y",
        value: parseSpacingValue(spaceMatch[2], isNegative),
      },
    ];
  }

  for (const [prefix, properties] of SIZE_PROPERTIES) {
    if (!unsignedUtility.startsWith(`${prefix}-`)) continue;
    const value = parseSpacingValue(unsignedUtility.slice(prefix.length + 1), isNegative);
    return properties.map((property) => ({ property, value }));
  }

  const flexMatch = unsignedUtility.match(/^(grow|shrink)(?:-(.+))?$/);
  if (flexMatch) {
    const value = flexMatch[2] ? parseFlexFactor(flexMatch[2]) : 1;
    return [{ property: `flex-${flexMatch[1]}`, value }];
  }

  const leadingMatch = unsignedUtility.match(/^leading-(.+)$/);
  if (leadingMatch) {
    return [
      {
        property: "line-height",
        value: parseSpacingValue(leadingMatch[1], isNegative),
      },
    ];
  }

  const trackingMatch = unsignedUtility.match(/^tracking-(.+)$/);
  if (trackingMatch) {
    return [
      {
        property: "letter-spacing",
        value: parseSpacingValue(trackingMatch[1], isNegative),
      },
    ];
  }

  if (FONT_WEIGHT_UTILITIES.has(unsignedUtility)) {
    return [{ property: "font-weight", value: unsignedUtility }];
  }

  const fontSizePx = parseStaticTailwindFontSize(unsignedUtility);
  if (fontSizePx !== null) return [{ property: "font-size", value: fontSizePx }];

  return [];
};

const getLayoutPropertyDeclaration = (
  utility: string,
  property: string,
): LayoutPropertyDeclaration | null =>
  getLayoutPropertyDeclarations(utility).find((declaration) => declaration.property === property) ??
  null;

const getLayoutShiftingInteractionToken = (className: string): string | null => {
  const rawTokens = splitTailwindClassName(className);
  const parsedTokens: ParsedClassNameToken[] = rawTokens.map((rawToken) => ({
    ...parseTailwindClassNameToken(rawToken),
    rawToken,
  }));
  const restingTokens = parsedTokens
    .filter((parsedToken) => !hasInteractionVariant(parsedToken.variants))
    .map((parsedToken) => parsedToken.rawToken);
  const interactionTokens = parsedTokens
    .filter((parsedToken) => hasInteractionVariant(parsedToken.variants))
    .sort(
      (leftToken, rightToken) => Number(rightToken.isImportant) - Number(leftToken.isImportant),
    );

  for (const interactionToken of interactionTokens) {
    for (const interactionDeclaration of getLayoutPropertyDeclarations(interactionToken.utility)) {
      if (interactionDeclaration.value === null) continue;
      const propertyPredicate = (utility: string): boolean =>
        getLayoutPropertyDeclaration(utility, interactionDeclaration.property) !== null;
      const effectiveResolution = resolveEffectiveTailwindClassNameToken(
        rawTokens,
        propertyPredicate,
        interactionToken.variants,
      );
      if (effectiveResolution.utility !== interactionToken.utility) continue;
      const effectiveDeclaration = getLayoutPropertyDeclaration(
        effectiveResolution.utility,
        interactionDeclaration.property,
      );
      if (!effectiveDeclaration || effectiveDeclaration.value === null) continue;
      const restingResolution = resolveEffectiveTailwindClassNameToken(
        restingTokens,
        propertyPredicate,
        interactionToken.variants,
      );
      if (restingResolution.isAmbiguous) continue;
      if (!restingResolution.utility) return interactionToken.rawToken;
      const restingDeclaration = getLayoutPropertyDeclaration(
        restingResolution.utility,
        interactionDeclaration.property,
      );
      if (!restingDeclaration || restingDeclaration.value === null) continue;
      if (restingDeclaration.value !== effectiveDeclaration.value) return interactionToken.rawToken;
    }
  }
  return null;
};

export const noLayoutShiftingInteractionState = defineRule({
  id: "no-layout-shifting-interaction-state",
  title: "Interaction state changes layout geometry",
  severity: "warn",
  category: "Design",
  defaultEnabled: false,
  recommendation:
    "Keep hover, focus, and pressed feedback to paint-only or transform properties so nearby content does not move when the state changes.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const className = getStringFromClassNameAttr(node);
      if (!className) return;
      const token = getLayoutShiftingInteractionToken(className);
      if (!token) return;
      context.report({
        node,
        message: `The interaction utility "${token}" changes layout or font metrics, so nearby content can jump. Use color, shadow, opacity, or transform feedback instead.`,
      });
    },
  }),
});
