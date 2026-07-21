import {
  PAGE_SPACING_DOMINANT_RATIO,
  PAGE_SPACING_MAX_DISTINCT_VALUES,
  PAGE_SPACING_MIN_SAMPLES,
  ROOT_FONT_SIZE_PX,
  TAILWIND_SPACING_UNIT_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

interface TailwindSpacingState {
  isAmbiguous: boolean;
  isImportant: boolean;
  valuePx: number;
}

const SPACING_CLASS_PATTERN = /^(p[trblxy]?|m[trblxy]?|gap(?:-[xy])?)-([\d.]+)$/;
const SPACING_SLOTS = new Map<string, string[]>([
  ["p", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
  ["px", ["padding-right", "padding-left"]],
  ["py", ["padding-top", "padding-bottom"]],
  ["pt", ["padding-top"]],
  ["pr", ["padding-right"]],
  ["pb", ["padding-bottom"]],
  ["pl", ["padding-left"]],
  ["m", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
  ["mx", ["margin-right", "margin-left"]],
  ["my", ["margin-top", "margin-bottom"]],
  ["mt", ["margin-top"]],
  ["mr", ["margin-right"]],
  ["mb", ["margin-bottom"]],
  ["ml", ["margin-left"]],
  ["gap", ["row-gap", "column-gap"]],
  ["gap-x", ["column-gap"]],
  ["gap-y", ["row-gap"]],
]);
const SPACING_STYLE_PROPERTIES = new Set([
  "gap",
  "columnGap",
  "rowGap",
  "margin",
  "marginBlock",
  "marginInline",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingBlock",
  "paddingInline",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
]);

const getSpacingPx = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue) return null;
  const match = stringValue.match(/^([\d.]+)(px|rem)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};

const collectClassSpacing = (classNameValue: string, spacingSamples: number[]): void => {
  const stateBySlot = new Map<string, TailwindSpacingState>();
  for (const token of getUnvariantClassNameTokensWithImportantModifiers(classNameValue)) {
    const parsedToken = parseTailwindClassNameToken(token);
    const match = parsedToken.utility.match(SPACING_CLASS_PATTERN);
    if (!match) continue;
    const affectedSlots = SPACING_SLOTS.get(match[1]);
    if (!affectedSlots) continue;
    const valuePx = Number.parseFloat(match[2]) * TAILWIND_SPACING_UNIT_PX;
    for (const affectedSlot of affectedSlots) {
      const currentState = stateBySlot.get(affectedSlot);
      if (!currentState || (parsedToken.isImportant && !currentState.isImportant)) {
        stateBySlot.set(affectedSlot, {
          isAmbiguous: false,
          isImportant: parsedToken.isImportant,
          valuePx,
        });
        continue;
      }
      if (!parsedToken.isImportant && currentState.isImportant) continue;
      if (currentState.valuePx !== valuePx) currentState.isAmbiguous = true;
    }
  }
  if ([...stateBySlot.values()].some((state) => state.isAmbiguous)) return;
  const effectiveValues = new Set([...stateBySlot.values()].map((state) => state.valuePx));
  spacingSamples.push(...effectiveValues);
};

const hasImportantClassSpacing = (classNameValue: string): boolean =>
  getUnvariantClassNameTokensWithImportantModifiers(classNameValue).some((token) => {
    const parsedToken = parseTailwindClassNameToken(token);
    return parsedToken.isImportant && SPACING_CLASS_PATTERN.test(parsedToken.utility);
  });

const collectInlineSpacing = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  spacingSamples: number[],
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes ?? [], "style");
  if (!styleAttribute) return hasJsxSpreadAttribute(openingElement.attributes);
  const styleExpression = getInlineStyleExpression(styleAttribute);
  if (!styleExpression) return true;
  let hasInlineSpacing = false;
  for (const propertyName of SPACING_STYLE_PROPERTIES) {
    const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
    if (!property) continue;
    hasInlineSpacing = true;
    const spacingPx = getSpacingPx(property);
    if (spacingPx !== null) spacingSamples.push(spacingPx);
  }
  return (
    hasInlineSpacing ||
    styleExpression.properties.some((property) => getStylePropertyKey(property) === null)
  );
};

export const noMonotonousPageSpacing = defineRule({
  id: "no-monotonous-page-spacing",
  title: "Page repeats one spacing value throughout",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use deliberate spacing tiers to distinguish local groups, components, and page sections.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== "main"
      ) {
        return;
      }
      const spacingSamples: number[] = [];
      const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        if (!isProvenIntrinsicJsxElement(openingElement, context.scopes)) continue;
        const sampleStartIndex = spacingSamples.length;
        const hasInlineSpacing = collectInlineSpacing(openingElement, spacingSamples);
        const classNameValue = getStringFromClassNameAttr(openingElement);
        if (
          classNameValue &&
          hasTailwind &&
          hasInlineSpacing &&
          hasImportantClassSpacing(classNameValue)
        ) {
          spacingSamples.length = sampleStartIndex;
          continue;
        }
        if (classNameValue && hasTailwind && !hasInlineSpacing) {
          collectClassSpacing(classNameValue, spacingSamples);
        }
      }
      if (spacingSamples.length < PAGE_SPACING_MIN_SAMPLES) return;
      const counts = new Map<number, number>();
      for (const sample of spacingSamples) counts.set(sample, (counts.get(sample) ?? 0) + 1);
      if (counts.size > PAGE_SPACING_MAX_DISTINCT_VALUES) return;
      const dominantCount = Math.max(...counts.values());
      if (dominantCount / spacingSamples.length < PAGE_SPACING_DOMINANT_RATIO) return;
      const dominantSpacing = [...counts].find(([, count]) => count === dominantCount)?.[0];
      context.report({
        node: node.openingElement,
        message: `One ${dominantSpacing}px spacing value accounts for ${dominantCount} of ${spacingSamples.length} explicit page measurements. Add spacing tiers that reflect content hierarchy.`,
      });
    },
  }),
});
