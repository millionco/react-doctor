import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import { getTailwindTransitionPropertyEffect } from "../../utils/get-tailwind-transition-property-effect.js";
import { getTailwindTransitionAllState } from "../../utils/get-tailwind-transition-all-state.js";
import { hasCapability, hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveTailwindBooleanPropertyState } from "../../utils/resolve-tailwind-boolean-property-state.js";
import { resolveTailwindTransitionDurationState } from "../../utils/resolve-tailwind-transition-duration-state.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getEffectiveCssTransitionEvidence } from "../design/utils/get-effective-css-transition-evidence.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "../design/utils/get-style-property-string-value.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { hasImportantTailwindClassNameToken } from "../../utils/has-important-tailwind-class-name-token.js";
import { getTailwindArbitraryUtilityValue } from "../../utils/get-tailwind-arbitrary-utility-value.js";
import { normalizeTailwindArbitraryUtilityValue } from "../../utils/normalize-tailwind-arbitrary-utility-value.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const ARBITRARY_ZERO_SCALE_PATTERN = /^[+-]?(?:0+(?:\.0*)?|\.0+)%?$/;
const SCALE_TRANSITION_PROPERTY_NAMES = new Set(["scale", "transform"]);
const ZERO_SCALE_UTILITY_PREFIXES = ["scale-x-", "scale-y-", "scale-"];
const TAILWIND_V4_INDIVIDUAL_SCALE_TRANSITION_UTILITIES = new Set([
  "transition",
  "transition-transform",
]);
const ARBITRARY_SCALE_PROPERTY_PREFIX = "[scale:";
const ARBITRARY_TRANSFORM_PROPERTY_PREFIX = "[transform:";
const ARBITRARY_TRANSFORM_UTILITY_PREFIX = "transform-[";
const ZERO_SCALE_TRANSFORM_PATTERN =
  /\b(?:scale[xy]\(\s*[+-]?(?:0+(?:\.0*)?|\.0+)\s*\)|scale\(\s*[+-]?(?:0+(?:\.0*)?|\.0+)\s*(?:,\s*[+-]?(?:0+(?:\.0*)?|\.0+)\s*)?\))/i;

const hasZeroIndividualScale = (property: EsTreeNodeOfType<"Property">): boolean => {
  if (!isNodeOfType(property.value, "Literal")) return false;
  if (Object.is(property.value.value, 0) || Object.is(property.value.value, -0)) return true;
  if (typeof property.value.value !== "string") return false;
  const scaleComponents = property.value.value.trim().split(/\s+/);
  return (
    scaleComponents.length > 0 &&
    scaleComponents.every((scaleComponent) => ARBITRARY_ZERO_SCALE_PATTERN.test(scaleComponent))
  );
};

const isZeroScaleValue = (value: string): boolean => {
  const scaleComponents = normalizeTailwindArbitraryUtilityValue(value).trim().split(/\s+/);
  return (
    scaleComponents.length > 0 &&
    scaleComponents.every((scaleComponent) => ARBITRARY_ZERO_SCALE_PATTERN.test(scaleComponent))
  );
};

const getBuiltInScaleZeroState = (utility: string): boolean | null => {
  if (!utility.startsWith("scale-") || utility.startsWith("scale-origin-")) return null;
  const utilityPrefix = ZERO_SCALE_UTILITY_PREFIXES.find((prefix) => utility.startsWith(prefix));
  if (!utilityPrefix) return null;
  const scaleValue = utility.slice(utilityPrefix.length);
  if (scaleValue === "0") return true;
  if (!scaleValue.startsWith("[") || !scaleValue.endsWith("]")) return false;
  return isZeroScaleValue(scaleValue.slice(1, -1));
};

const getArbitraryTransformScaleZeroState = (utility: string): boolean | null => {
  const transformValue =
    getTailwindArbitraryUtilityValue(utility, ARBITRARY_TRANSFORM_PROPERTY_PREFIX) ??
    getTailwindArbitraryUtilityValue(utility, ARBITRARY_TRANSFORM_UTILITY_PREFIX);
  return transformValue === null
    ? null
    : ZERO_SCALE_TRANSFORM_PATTERN.test(normalizeTailwindArbitraryUtilityValue(transformValue));
};

const getArbitraryIndividualScaleZeroState = (utility: string): boolean | null => {
  const scaleValue = getTailwindArbitraryUtilityValue(utility, ARBITRARY_SCALE_PROPERTY_PREFIX);
  return scaleValue === null ? null : isZeroScaleValue(scaleValue);
};

const getScaleZeroState = (utility: string): boolean | null => {
  const builtInScaleState = getBuiltInScaleZeroState(utility);
  if (builtInScaleState !== null) return builtInScaleState;
  const transformScaleState = getArbitraryTransformScaleZeroState(utility);
  return transformScaleState ?? getArbitraryIndividualScaleZeroState(utility);
};

const getTransformScaleZeroState = (
  utility: string,
  hasTailwindIndividualScaleProperty: boolean,
): boolean | null =>
  getArbitraryTransformScaleZeroState(utility) ??
  (hasTailwindIndividualScaleProperty ? null : getBuiltInScaleZeroState(utility));

const getIndividualScaleZeroState = (
  utility: string,
  hasTailwindIndividualScaleProperty: boolean,
): boolean | null =>
  getArbitraryIndividualScaleZeroState(utility) ??
  (hasTailwindIndividualScaleProperty ? getBuiltInScaleZeroState(utility) : null);

const getTransformTransitionState = (utility: string): boolean | null =>
  getTailwindTransitionPropertyEffect(utility)?.includesTransform ?? null;

const getScaleTransitionState = (
  utility: string,
  hasTailwindIndividualScaleProperty: boolean,
): boolean | null => {
  const transitionEffect = getTailwindTransitionPropertyEffect(utility);
  if (!transitionEffect) return null;
  if (
    !hasTailwindIndividualScaleProperty &&
    TAILWIND_V4_INDIVIDUAL_SCALE_TRANSITION_UTILITIES.has(utility)
  ) {
    return false;
  }
  return transitionEffect.includesScale;
};

const getScaleRelevantTransitionState = (utility: string): boolean | null => {
  const transitionEffect = getTailwindTransitionPropertyEffect(utility);
  return transitionEffect
    ? transitionEffect.includesScale || transitionEffect.includesTransform
    : null;
};

const isTransitionDurationSetter = (utility: string): boolean =>
  !utility.startsWith("[transition-property:") &&
  (utility.startsWith("duration-") ||
    utility.startsWith("[transition-duration:") ||
    utility.startsWith("[transition:") ||
    getTailwindTransitionPropertyEffect(utility) !== null);

const hasScaleZeroTransitionClassName = (classNameValue: string): boolean => {
  const parsedTokens = splitTailwindClassName(classNameValue).map(parseTailwindClassNameToken);
  return parsedTokens.some(
    (parsedToken) =>
      resolveTailwindBooleanPropertyState(parsedTokens, parsedToken.variants, getScaleZeroState) ===
        true &&
      resolveTailwindBooleanPropertyState(
        parsedTokens,
        parsedToken.variants,
        getScaleRelevantTransitionState,
      ) === true &&
      resolveTailwindTransitionDurationState(
        parsedTokens,
        parsedToken.variants,
        SCALE_TRANSITION_PROPERTY_NAMES,
      ) === true,
  );
};

const hasMergedScaleZeroTransition = (
  classNameValue: string,
  styleAttribute: EsTreeNodeOfType<"JSXAttribute"> | null,
  reportNode: EsTreeNodeOfType<"JSXOpeningElement">,
  hasTailwindIndividualScaleProperty: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const parsedTokens = splitTailwindClassName(classNameValue).map(parseTailwindClassNameToken);
  const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute, scopes) : null;
  if (styleAttribute && !styleExpression) return false;
  const inlineTransformProperty = getEffectiveStyleProperty(
    styleExpression?.properties,
    "transform",
  );
  const inlineScaleProperty = getEffectiveStyleProperty(styleExpression?.properties, "scale");
  const variantScopes = [[], ...parsedTokens.map((parsedToken) => parsedToken.variants)];

  return variantScopes.some((variantScope) => {
    const transformScaleZeroState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      variantScope,
      (utility) => getTransformScaleZeroState(utility, hasTailwindIndividualScaleProperty),
    );
    const individualScaleZeroState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      variantScope,
      (utility) => getIndividualScaleZeroState(utility, hasTailwindIndividualScaleProperty),
    );
    const hasImportantTransformScaleSetter = hasImportantTailwindClassNameToken(
      parsedTokens,
      variantScope,
      (utility) => getTransformScaleZeroState(utility, hasTailwindIndividualScaleProperty) !== null,
    );
    const hasImportantIndividualScaleSetter = hasImportantTailwindClassNameToken(
      parsedTokens,
      variantScope,
      (utility) =>
        getIndividualScaleZeroState(utility, hasTailwindIndividualScaleProperty) !== null,
    );
    const hasApplicableTransformScaleSetter = parsedTokens.some(
      (parsedToken) =>
        getTransformScaleZeroState(parsedToken.utility, hasTailwindIndividualScaleProperty) !==
          null && doesTailwindVariantScopeCover(parsedToken.variants, variantScope),
    );
    const hasApplicableIndividualScaleSetter = parsedTokens.some(
      (parsedToken) =>
        getIndividualScaleZeroState(parsedToken.utility, hasTailwindIndividualScaleProperty) !==
          null && doesTailwindVariantScopeCover(parsedToken.variants, variantScope),
    );
    const transformValue =
      inlineTransformProperty && !hasImportantTransformScaleSetter
        ? getStylePropertyStringValue(inlineTransformProperty)
        : null;
    const hasInlineTransformZero = Boolean(
      transformValue && ZERO_SCALE_TRANSFORM_PATTERN.test(transformValue),
    );
    const hasInlineScaleZero = Boolean(
      inlineScaleProperty &&
      !hasImportantIndividualScaleSetter &&
      hasZeroIndividualScale(inlineScaleProperty),
    );
    const hasClassTransformScaleZero =
      hasApplicableTransformScaleSetter &&
      transformScaleZeroState === true &&
      (hasImportantTransformScaleSetter || !inlineTransformProperty);
    const hasClassIndividualScaleZero =
      hasApplicableIndividualScaleSetter &&
      individualScaleZeroState === true &&
      (hasImportantIndividualScaleSetter || !inlineScaleProperty);
    const hasEffectiveTransformScaleZero = hasInlineTransformZero || hasClassTransformScaleZero;
    const hasEffectiveIndividualScaleZero = hasInlineScaleZero || hasClassIndividualScaleZero;
    if (!hasEffectiveTransformScaleZero && !hasEffectiveIndividualScaleZero) return false;

    const hasApplicableTransitionSetter = parsedTokens.some(
      (parsedToken) =>
        getScaleRelevantTransitionState(parsedToken.utility) !== null &&
        doesTailwindVariantScopeCover(parsedToken.variants, variantScope),
    );
    const transitionAllState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      variantScope,
      getTailwindTransitionAllState,
    );
    const transformTransitionState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      variantScope,
      getTransformTransitionState,
    );
    const scaleTransitionState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      variantScope,
      (utility) => getScaleTransitionState(utility, hasTailwindIndividualScaleProperty),
    );
    const durationState = resolveTailwindTransitionDurationState(
      parsedTokens,
      variantScope,
      SCALE_TRANSITION_PROPERTY_NAMES,
    );
    const hasImportantTransitionProperty = hasImportantTailwindClassNameToken(
      parsedTokens,
      variantScope,
      (utility) => getScaleRelevantTransitionState(utility) !== null,
    );
    const hasImportantTransitionDuration = hasImportantTailwindClassNameToken(
      parsedTokens,
      variantScope,
      isTransitionDurationSetter,
    );
    const transitionEvidence = getEffectiveCssTransitionEvidence(
      styleExpression?.properties,
      [
        {
          hasPositiveDuration: durationState === true,
          propertyName: !hasApplicableTransitionSetter
            ? "all"
            : transitionAllState === true
              ? "all"
              : hasEffectiveIndividualScaleZero && scaleTransitionState === true
                ? "scale"
                : hasEffectiveTransformScaleZero && transformTransitionState === true
                  ? "transform"
                  : "opacity",
          sourceNode: reportNode,
        },
      ],
      {
        duration: hasImportantTransitionDuration,
        property: hasImportantTransitionProperty,
      },
    );
    return transitionEvidence?.some(
      (transition) =>
        transition.durationMilliseconds > 0 &&
        (transition.propertyName === "all" ||
          (hasEffectiveTransformScaleZero && transition.propertyName === "transform") ||
          (hasEffectiveIndividualScaleZero && transition.propertyName === "scale")),
    );
  });
};

export const noScaleFromZero = defineRule({
  id: "no-scale-from-zero",
  title: "Animating scale from zero",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `initial={{ scale: 0.95, opacity: 0 }}`. Elements should gently shrink and fade, not vanish into a point",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "initial" && node.name.name !== "exit") return;
      const openingElement = node.parent;
      if (
        !openingElement ||
        !isNodeOfType(openingElement, "JSXOpeningElement") ||
        !Object.is(getAuthoritativeJsxAttribute(openingElement.attributes, node.name.name), node) ||
        !isProvenFramerMotionJsxElement(openingElement, context.scopes)
      ) {
        return;
      }
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      const property = getEffectiveStyleProperty(expression.properties, "scale");
      if (property && isNodeOfType(property.value, "Literal") && property.value.value === 0) {
        context.report({
          node: property,
          message:
            "This looks abrupt to your users because scale: 0 pops the element in from a single point, so use scale: 0.95 with opacity: 0 for a smoother entrance",
        });
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
      const hasTailwindIndividualScaleProperty = hasCapability(context.settings, "tailwind:4");
      const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className");
      const classNameValues =
        hasTailwind && classNameAttribute
          ? getJsxPropStaticStringValues(classNameAttribute, context.scopes)
          : [""];
      if (!classNameValues) return;
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      if (
        !classNameValues.some((classNameValue) =>
          hasMergedScaleZeroTransition(
            classNameValue,
            styleAttribute,
            node,
            hasTailwindIndividualScaleProperty,
            context.scopes,
          ),
        )
      ) {
        return;
      }
      context.report({
        node,
        message: classNameValues.some(hasScaleZeroTransitionClassName)
          ? "This scale transition makes the element disappear completely. Use a small nonzero scale with opacity instead."
          : "This transition collapses the element to nothing. Keep a small visible scale and use opacity for the rest of the entrance or exit.",
      });
    },
  }),
});
