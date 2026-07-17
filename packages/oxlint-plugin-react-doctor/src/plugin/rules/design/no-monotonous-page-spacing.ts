import {
  PAGE_SPACING_DOMINANT_RATIO,
  PAGE_SPACING_MAX_DISTINCT_VALUES,
  PAGE_SPACING_MIN_SAMPLES,
  ROOT_FONT_SIZE_PX,
  TAILWIND_SPACING_UNIT_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const SPACING_CLASS_PATTERN = /^(?:p[trblxy]?|m[trblxy]?|gap(?:-[xy])?)-([\d.]+)$/;
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
  for (const token of getUnvariantClassNameTokens(classNameValue)) {
    const match = token.match(SPACING_CLASS_PATTERN);
    if (match) spacingSamples.push(parseFloat(match[1]) * TAILWIND_SPACING_UNIT_PX);
  }
};

const collectInlineSpacing = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  spacingSamples: number[],
): void => {
  for (const attribute of openingElement.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const styleExpression = getInlineStyleExpression(attribute);
    if (!styleExpression) continue;
    for (const propertyName of SPACING_STYLE_PROPERTIES) {
      const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
      if (!property) continue;
      const spacingPx = getSpacingPx(property);
      if (spacingPx !== null) spacingSamples.push(spacingPx);
    }
  }
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
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        const classNameValue = getStringFromClassNameAttr(openingElement);
        if (classNameValue) collectClassSpacing(classNameValue, spacingSamples);
        collectInlineSpacing(openingElement, spacingSamples);
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
