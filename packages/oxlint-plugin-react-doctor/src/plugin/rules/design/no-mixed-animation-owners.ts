import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { TAILWIND_BREAKPOINT_RANKS } from "../../constants/tailwind.js";
import { defineRule } from "../../utils/define-rule.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../utils/get-effective-object-properties-in-insertion-order.js";
import { getHighestPriorityTailwindClassNameTokens } from "../../utils/get-highest-priority-tailwind-class-name-tokens.js";
import { getJsxPropExhaustiveStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getTailwindTransitionPropertyEffect } from "../../utils/get-tailwind-transition-property-effect.js";
import { hasCapability, hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { normalizeTailwindArbitraryUtilityValue } from "../../utils/normalize-tailwind-arbitrary-utility-value.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getCssTransitionShorthandEvidence } from "./utils/get-css-transition-shorthand-evidence.js";
import { getEffectiveCssTransitionEvidence } from "./utils/get-effective-css-transition-evidence.js";
import type { CssTransitionDefaultEvidence } from "./utils/get-effective-css-transition-evidence.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";

interface MotionOwnedPropertyEvidence {
  activationTailwindVariant: string | null;
  excludedTailwindVariants: ReadonlySet<string>;
  propertyName: string;
}

interface MotionTargetTailwindConstraints {
  activationVariant: string | null;
  excludedVariants: ReadonlySet<string>;
}

interface TailwindLocalAttributeConstraint {
  attributeName: string;
  expectedValue: string | null;
}

interface TailwindTransitionDeclaration {
  durationStates: ReadonlyArray<boolean> | null;
  propertyNames: ReadonlyArray<string> | null;
}

interface TailwindTransitionState {
  defaultEvidence: CssTransitionDefaultEvidence[];
  isDurationImportant: boolean;
  isPropertyImportant: boolean;
}

interface TailwindExhaustiveTransitionPartition {
  commonScope: ReadonlyArray<string>;
  leftVariant: string;
  rightVariant: string;
}

const MOTION_TARGET_PROPERTIES: ReadonlyArray<string> = [
  "animate",
  "exit",
  "whileDrag",
  "whileFocus",
  "whileHover",
  "whileInView",
  "whileTap",
];
const MOTION_TARGET_TAILWIND_CONSTRAINTS = new Map<string, MotionTargetTailwindConstraints>([
  ["animate", { activationVariant: null, excludedVariants: new Set() }],
  ["exit", { activationVariant: null, excludedVariants: new Set() }],
  ["whileDrag", { activationVariant: null, excludedVariants: new Set() }],
  [
    "whileFocus",
    { activationVariant: "focus", excludedVariants: new Set(["disabled", "not-focus"]) },
  ],
  ["whileHover", { activationVariant: "hover", excludedVariants: new Set(["not-hover"]) }],
  ["whileInView", { activationVariant: null, excludedVariants: new Set() }],
  [
    "whileTap",
    { activationVariant: "active", excludedVariants: new Set(["disabled", "not-active"]) },
  ],
]);
const MOTION_TRANSFORM_PROPERTIES = new Set([
  "originX",
  "originY",
  "originZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "scale",
  "scaleX",
  "scaleY",
  "scaleZ",
  "skew",
  "skewX",
  "skewY",
  "transform",
  "transformPerspective",
  "translateX",
  "translateY",
  "translateZ",
  "x",
  "y",
  "z",
]);
const MOTION_TARGET_METADATA_PROPERTIES = new Set(["transition", "transitionEnd"]);
const MOTION_SVG_ATTRIBUTE_PROPERTIES = new Set([
  "attrScale",
  "attrX",
  "attrY",
  "d",
  "pathLength",
  "pathOffset",
  "pathSpacing",
  "points",
  "viewBox",
]);
const TAILWIND_DEFAULT_TRANSITION_PROPERTIES = [
  "backdrop-filter",
  "background-color",
  "border-color",
  "box-shadow",
  "color",
  "fill",
  "filter",
  "opacity",
  "rotate",
  "scale",
  "stroke",
  "text-decoration-color",
  "transform",
  "translate",
];
const TAILWIND_COLOR_TRANSITION_PROPERTIES = [
  "background-color",
  "border-color",
  "color",
  "fill",
  "stroke",
  "text-decoration-color",
];
const CSS_TIME_PATTERN = /^([+-]?\d*\.?\d+)(ms|s)$/i;
const TAILWIND_TRANSITION_DURATION_PREFIX = "[transition-duration:";
const NON_INTERPOLABLE_CSS_TRANSITION_PROPERTIES = new Set([
  "content-visibility",
  "display",
  "overlay",
  "pointer-events",
]);
const TAILWIND_EXCLUSIVE_VARIANT_FAMILIES = new Map([
  ["contrast-less", "contrast"],
  ["contrast-more", "contrast"],
  ["disabled", "availability"],
  ["enabled", "availability"],
  ["even", "sibling-position"],
  ["in-range", "range-validity"],
  ["invalid", "validity"],
  ["landscape", "orientation"],
  ["link", "link-history"],
  ["ltr", "direction"],
  ["motion-reduce", "reduced-motion"],
  ["motion-safe", "reduced-motion"],
  ["optional", "requirement"],
  ["odd", "sibling-position"],
  ["out-of-range", "range-validity"],
  ["pointer-coarse", "primary-pointer"],
  ["pointer-fine", "primary-pointer"],
  ["portrait", "orientation"],
  ["read-only", "editability"],
  ["read-write", "editability"],
  ["required", "requirement"],
  ["rtl", "direction"],
  ["valid", "validity"],
  ["visited", "link-history"],
]);
const TAILWIND_COEXECUTING_VARIANTS = new Set([
  "active",
  "any-pointer-coarse",
  "any-pointer-fine",
  "checked",
  "dark",
  "disabled",
  "empty",
  "enabled",
  "first",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "forced-colors",
  "hover",
  "in-range",
  "indeterminate",
  "invalid",
  "last",
  "last-of-type",
  "link",
  "motion-reduce",
  "motion-safe",
  "odd",
  "only",
  "only-of-type",
  "open",
  "optional",
  "out-of-range",
  "placeholder-shown",
  "pointer-coarse",
  "pointer-fine",
  "read-only",
  "read-write",
  "required",
  "target",
  "valid",
  "visited",
]);
const TAILWIND_PSEUDO_ELEMENT_VARIANTS = new Set([
  "after",
  "backdrop",
  "before",
  "details-content",
  "file",
  "first-letter",
  "first-line",
  "marker",
  "placeholder",
  "selection",
]);

const normalizeMotionTargetPropertyName = (propertyName: string): string | null => {
  if (
    MOTION_TARGET_METADATA_PROPERTIES.has(propertyName) ||
    MOTION_SVG_ATTRIBUTE_PROPERTIES.has(propertyName)
  ) {
    return null;
  }
  if (MOTION_TRANSFORM_PROPERTIES.has(propertyName)) {
    return propertyName.startsWith("origin") ? "transform-origin" : "transform";
  }
  if (propertyName.startsWith("--")) return propertyName;
  const kebabCasePropertyName = propertyName
    .replace(/^Webkit(?=[A-Z])/, "-webkit")
    .replace(/^Moz(?=[A-Z])/, "-moz")
    .replace(/^ms(?=[A-Z])/, "-ms")
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    .toLowerCase();
  return /^--[a-z0-9_-]+$|^-?[a-z][a-z0-9-]*$/.test(kebabCasePropertyName)
    ? kebabCasePropertyName
    : null;
};

const getMotionOwnedPropertyEvidence = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): MotionOwnedPropertyEvidence[] | null => {
  const evidenceByKey = new Map<string, MotionOwnedPropertyEvidence>();
  for (const targetPropertyName of MOTION_TARGET_PROPERTIES) {
    const attribute = getAuthoritativeJsxAttribute(node.attributes, targetPropertyName);
    if (!attribute) {
      const hasOverriddenTargetAttribute = node.attributes.some(
        (candidate) =>
          isNodeOfType(candidate, "JSXAttribute") &&
          isNodeOfType(candidate.name, "JSXIdentifier") &&
          candidate.name.name === targetPropertyName,
      );
      if (hasOverriddenTargetAttribute) return null;
      continue;
    }
    const objectExpression = getStaticMotionPropObject(node, targetPropertyName, scopes);
    if (!objectExpression) return null;
    const properties = getEffectiveObjectPropertiesInInsertionOrder(objectExpression.properties);
    if (!properties) return null;
    const tailwindConstraints = MOTION_TARGET_TAILWIND_CONSTRAINTS.get(targetPropertyName);
    if (!tailwindConstraints) return null;
    for (const property of properties) {
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (!propertyName) return null;
      const normalizedPropertyName = normalizeMotionTargetPropertyName(propertyName);
      if (!normalizedPropertyName) continue;
      const evidenceKey = `${normalizedPropertyName}:${targetPropertyName}`;
      evidenceByKey.set(evidenceKey, {
        activationTailwindVariant: tailwindConstraints.activationVariant,
        excludedTailwindVariants: tailwindConstraints.excludedVariants,
        propertyName: normalizedPropertyName,
      });
    }
  }
  return [...evidenceByKey.values()];
};

const parseTransitionDurationStates = (value: string): boolean[] | null => {
  const states: boolean[] = [];
  for (const rawDuration of value.split(",")) {
    const durationMatch = CSS_TIME_PATTERN.exec(rawDuration.trim());
    if (!durationMatch) return null;
    const duration = Number(durationMatch[1]);
    if (duration < 0) return null;
    states.push(duration > 0);
  }
  return states.length > 0 ? states : null;
};

const getTailwindDurationDeclaration = (utility: string): TailwindTransitionDeclaration | null => {
  if (utility.startsWith("duration-")) {
    const durationValue = utility.slice("duration-".length);
    const normalizedDurationValue =
      durationValue.startsWith("[") && durationValue.endsWith("]")
        ? normalizeTailwindArbitraryUtilityValue(durationValue.slice(1, -1))
        : `${durationValue}ms`;
    return {
      durationStates: parseTransitionDurationStates(normalizedDurationValue),
      propertyNames: null,
    };
  }
  if (utility.startsWith(TAILWIND_TRANSITION_DURATION_PREFIX) && utility.endsWith("]")) {
    return {
      durationStates: parseTransitionDurationStates(
        normalizeTailwindArbitraryUtilityValue(
          utility.slice(TAILWIND_TRANSITION_DURATION_PREFIX.length, -1),
        ),
      ),
      propertyNames: null,
    };
  }
  return null;
};

const getTailwindTransitionDeclaration = (
  utility: string,
  hasTailwindIndividualTransformProperties: boolean,
): TailwindTransitionDeclaration | null => {
  const effect = getTailwindTransitionPropertyEffect(utility);
  if (!effect) return null;
  if (utility === "transition") {
    return {
      durationStates: [true],
      propertyNames: hasTailwindIndividualTransformProperties
        ? [...TAILWIND_DEFAULT_TRANSITION_PROPERTIES, "outline-color"]
        : TAILWIND_DEFAULT_TRANSITION_PROPERTIES,
    };
  }
  if (utility === "transition-colors") {
    return {
      durationStates: [true],
      propertyNames: hasTailwindIndividualTransformProperties
        ? [...TAILWIND_COLOR_TRANSITION_PROPERTIES, "outline-color"]
        : TAILWIND_COLOR_TRANSITION_PROPERTIES,
    };
  }
  if (utility === "transition-opacity") {
    return { durationStates: [true], propertyNames: ["opacity"] };
  }
  if (utility === "transition-shadow") {
    return { durationStates: [true], propertyNames: ["box-shadow"] };
  }
  if (utility === "transition-transform") {
    return {
      durationStates: [true],
      propertyNames: hasTailwindIndividualTransformProperties
        ? ["rotate", "scale", "transform", "translate"]
        : ["transform"],
    };
  }
  if (utility === "transition-none") {
    return { durationStates: [false], propertyNames: ["none"] };
  }
  if (utility === "transition-all") {
    return { durationStates: [true], propertyNames: ["all"] };
  }
  if (utility.startsWith("[transition-property:")) {
    return { durationStates: null, propertyNames: effect.propertyNames };
  }
  if (utility.startsWith("transition-[")) {
    return { durationStates: [true], propertyNames: effect.propertyNames };
  }
  if (utility.startsWith("[transition:")) {
    const shorthandValue = utility.slice("[transition:".length, -1);
    const transitions = shorthandValue
      ? getCssTransitionShorthandEvidence(normalizeTailwindArbitraryUtilityValue(shorthandValue))
      : [];
    if (transitions.length === 0) return null;
    return {
      durationStates: transitions.map((transition) => transition.hasPositiveDuration),
      propertyNames: transitions.map((transition) => transition.propertyName),
    };
  }
  return effect.propertyNames
    ? { durationStates: [true], propertyNames: effect.propertyNames }
    : null;
};

const serializeTailwindTransitionDeclaration = (
  declaration: TailwindTransitionDeclaration,
): string => JSON.stringify(declaration);

const resolveTailwindTransitionDeclaration = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  variantScope: ReadonlyArray<string>,
  getDeclaration: (utility: string) => TailwindTransitionDeclaration | null,
): { declaration: TailwindTransitionDeclaration | null; isImportant: boolean } | null => {
  const effectiveTokens = getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      doesTailwindVariantScopeCover(parsedToken.variants, variantScope) &&
      getDeclaration(parsedToken.utility) !== null,
  );
  if (effectiveTokens.length === 0) return { declaration: null, isImportant: false };
  const declarations = effectiveTokens.flatMap((parsedToken) => {
    const declaration = getDeclaration(parsedToken.utility);
    return declaration ? [declaration] : [];
  });
  const serializedDeclarations = new Set(declarations.map(serializeTailwindTransitionDeclaration));
  if (serializedDeclarations.size !== 1) return null;
  return {
    declaration: declarations[0] ?? null,
    isImportant: effectiveTokens[0]?.isImportant ?? false,
  };
};

const getTailwindTransitionState = (
  className: string,
  variantScope: ReadonlyArray<string>,
  reportNode: EsTreeNode,
  hasTailwindIndividualTransformProperties: boolean,
): TailwindTransitionState | null => {
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  const propertyResolution = resolveTailwindTransitionDeclaration(
    parsedTokens,
    variantScope,
    (utility) =>
      getTailwindTransitionDeclaration(utility, hasTailwindIndividualTransformProperties),
  );
  const durationResolution = resolveTailwindTransitionDeclaration(
    parsedTokens,
    variantScope,
    getTailwindDurationDeclaration,
  );
  if (!propertyResolution || !durationResolution) return null;
  const propertyDeclaration = propertyResolution.declaration;
  const explicitDurationDeclaration = durationResolution.declaration;
  const propertyNames = propertyDeclaration?.propertyNames ?? ["all"];
  const durationStates = explicitDurationDeclaration?.durationStates ??
    propertyDeclaration?.durationStates ?? [false];
  if (!propertyNames || !durationStates) return null;
  return {
    defaultEvidence: propertyNames.map((propertyName, propertyIndex) => ({
      hasPositiveDuration: durationStates[propertyIndex % durationStates.length] ?? false,
      propertyName,
      sourceNode: reportNode,
    })),
    isDurationImportant: explicitDurationDeclaration
      ? durationResolution.isImportant
      : propertyResolution.isImportant,
    isPropertyImportant: propertyResolution.isImportant,
  };
};

const getTailwindBreakpointConstraint = (
  variant: string,
): { isMaximum: boolean; rank: number } | null => {
  const isMaximum = variant.startsWith("max-");
  const breakpointName = isMaximum ? variant.slice("max-".length) : variant;
  const rank = TAILWIND_BREAKPOINT_RANKS.get(breakpointName);
  return rank === undefined ? null : { isMaximum, rank };
};

const getTailwindKeyedState = (
  variant: string,
): { family: string; key: string; value: string } | null => {
  const match = /^(aria|data)-\[([^=\]]+)=([^\]]+)\]$/.exec(variant);
  return match?.[1] && match[2] && match[3]
    ? { family: match[1], key: match[2], value: match[3] }
    : null;
};

const isRecognizedCoexecutingTailwindVariant = (variant: string): boolean =>
  TAILWIND_COEXECUTING_VARIANTS.has(variant) ||
  TAILWIND_BREAKPOINT_RANKS.has(variant) ||
  (variant.startsWith("max-") && TAILWIND_BREAKPOINT_RANKS.has(variant.slice("max-".length))) ||
  TAILWIND_EXCLUSIVE_VARIANT_FAMILIES.has(variant) ||
  getTailwindKeyedState(variant) !== null;

const areTailwindVariantsMutuallyExclusive = (
  leftVariant: string,
  rightVariant: string,
): boolean => {
  if (leftVariant === rightVariant) return false;
  if (leftVariant === `not-${rightVariant}` || rightVariant === `not-${leftVariant}`) return true;
  const leftBreakpoint = getTailwindBreakpointConstraint(leftVariant);
  const rightBreakpoint = getTailwindBreakpointConstraint(rightVariant);
  if (leftBreakpoint && rightBreakpoint) {
    if (leftBreakpoint.isMaximum === rightBreakpoint.isMaximum) return false;
    const minimum = leftBreakpoint.isMaximum ? rightBreakpoint : leftBreakpoint;
    const maximum = leftBreakpoint.isMaximum ? leftBreakpoint : rightBreakpoint;
    return minimum.rank >= maximum.rank;
  }
  const leftFamily = TAILWIND_EXCLUSIVE_VARIANT_FAMILIES.get(leftVariant);
  const rightFamily = TAILWIND_EXCLUSIVE_VARIANT_FAMILIES.get(rightVariant);
  if (leftFamily && leftFamily === rightFamily) return true;
  const leftKeyedState = getTailwindKeyedState(leftVariant);
  const rightKeyedState = getTailwindKeyedState(rightVariant);
  if (
    leftKeyedState &&
    rightKeyedState &&
    leftKeyedState.family === rightKeyedState.family &&
    leftKeyedState.key === rightKeyedState.key
  ) {
    return leftKeyedState.value !== rightKeyedState.value;
  }
  return false;
};

const areTailwindVariantsProvenCompatible = (
  leftVariant: string,
  rightVariant: string,
): boolean => {
  if (areTailwindVariantsMutuallyExclusive(leftVariant, rightVariant)) return false;
  return (
    isRecognizedCoexecutingTailwindVariant(leftVariant) &&
    isRecognizedCoexecutingTailwindVariant(rightVariant)
  );
};

const isTailwindVariantScopeInternallyContradictory = (
  variantScope: ReadonlyArray<string>,
): boolean =>
  variantScope.some((leftVariant, leftIndex) =>
    variantScope
      .slice(leftIndex + 1)
      .some((rightVariant) => areTailwindVariantsMutuallyExclusive(leftVariant, rightVariant)),
  );

const areTailwindVariantScopesProvenCompatible = (
  leftScope: ReadonlyArray<string>,
  rightScope: ReadonlyArray<string>,
): boolean =>
  leftScope.every((leftVariant) =>
    rightScope.every((rightVariant) =>
      areTailwindVariantsProvenCompatible(leftVariant, rightVariant),
    ),
  );

const getTailwindVariantScopes = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
): string[][] => {
  const serializedScopes = new Set(["[]"]);
  const variantScopes: string[][] = [[]];
  for (const parsedToken of parsedTokens) {
    if (isTailwindVariantScopeInternallyContradictory(parsedToken.variants)) continue;
    const serializedScope = JSON.stringify(parsedToken.variants);
    if (serializedScopes.has(serializedScope)) continue;
    serializedScopes.add(serializedScope);
    variantScopes.push(parsedToken.variants);
  }
  const sourceScopes = [...variantScopes];
  for (const [leftIndex, leftScope] of sourceScopes.entries()) {
    for (const rightScope of sourceScopes.slice(leftIndex + 1)) {
      if (!areTailwindVariantScopesProvenCompatible(leftScope, rightScope)) continue;
      const combinedScope = [...leftScope, ...rightScope];
      const serializedScope = JSON.stringify(combinedScope);
      if (serializedScopes.has(serializedScope)) continue;
      serializedScopes.add(serializedScope);
      variantScopes.push(combinedScope);
    }
  }
  return variantScopes;
};

const getTailwindComplementaryVariant = (variant: string): string | null => {
  if (variant === "motion-safe") return "motion-reduce";
  if (variant === "motion-reduce") return "motion-safe";
  if (variant === "portrait") return "landscape";
  if (variant === "landscape") return "portrait";
  if (variant === "odd") return "even";
  if (variant === "even") return "odd";
  if (TAILWIND_BREAKPOINT_RANKS.has(variant)) return `max-${variant}`;
  if (variant.startsWith("max-") && TAILWIND_BREAKPOINT_RANKS.has(variant.slice("max-".length))) {
    return variant.slice("max-".length);
  }
  return null;
};

const isTailwindTransitionSetter = (
  utility: string,
  hasTailwindIndividualTransformProperties: boolean,
): boolean =>
  getTailwindDurationDeclaration(utility) !== null ||
  getTailwindTransitionDeclaration(utility, hasTailwindIndividualTransformProperties) !== null;

const getTailwindExhaustiveTransitionPartitions = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  hasTailwindIndividualTransformProperties: boolean,
): TailwindExhaustiveTransitionPartition[] => {
  const transitionScopes: Array<ReadonlyArray<string>> = [];
  for (const parsedToken of parsedTokens) {
    if (
      !isTailwindVariantScopeInternallyContradictory(parsedToken.variants) &&
      isTailwindTransitionSetter(parsedToken.utility, hasTailwindIndividualTransformProperties)
    ) {
      transitionScopes.push(parsedToken.variants);
    }
  }
  const partitions: TailwindExhaustiveTransitionPartition[] = [];
  const partitionKeys = new Set<string>();
  for (const leftScope of transitionScopes) {
    for (const [leftVariantIndex, leftVariant] of leftScope.entries()) {
      const rightVariant = getTailwindComplementaryVariant(leftVariant);
      if (!rightVariant) continue;
      const commonScope = leftScope.filter((_, variantIndex) => variantIndex !== leftVariantIndex);
      const hasRightBranch = transitionScopes.some((rightScope) => {
        const rightVariantIndex = rightScope.indexOf(rightVariant);
        if (rightVariantIndex < 0) return false;
        const rightCommonScope = rightScope.filter(
          (_, variantIndex) => variantIndex !== rightVariantIndex,
        );
        return JSON.stringify(rightCommonScope) === JSON.stringify(commonScope);
      });
      if (!hasRightBranch) continue;
      const orderedVariants = [leftVariant, rightVariant].sort();
      const partitionKey = JSON.stringify([commonScope, ...orderedVariants]);
      if (partitionKeys.has(partitionKey)) continue;
      partitionKeys.add(partitionKey);
      partitions.push({ commonScope, leftVariant, rightVariant });
    }
  }
  return partitions;
};

const doesTailwindScopeSelectExhaustiveTransitionBranches = (
  variantScope: ReadonlyArray<string>,
  partitions: ReadonlyArray<TailwindExhaustiveTransitionPartition>,
): boolean => {
  const variantScopeSet = new Set(variantScope);
  return partitions.every(
    (partition) =>
      !doesTailwindVariantScopeCover(partition.commonScope, variantScope) ||
      variantScopeSet.has(partition.leftVariant) ||
      variantScopeSet.has(partition.rightVariant),
  );
};

const parseTailwindLocalAttributeConstraint = (
  variant: string,
): TailwindLocalAttributeConstraint | null => {
  const arbitraryMatch = /^(aria|data)-\[([^=\]]+)(?:=([^\]]+))?\]$/.exec(variant);
  if (arbitraryMatch?.[1] && arbitraryMatch[2]) {
    const rawExpectedValue = arbitraryMatch[3];
    const expectedValue = rawExpectedValue?.replace(/^(['"])(.*)\1$/, "$2") ?? null;
    return {
      attributeName: `${arbitraryMatch[1]}-${arbitraryMatch[2]}`,
      expectedValue,
    };
  }
  const dataPresenceMatch = /^data-([a-z0-9_-]+)$/.exec(variant);
  if (dataPresenceMatch?.[1]) {
    return { attributeName: `data-${dataPresenceMatch[1]}`, expectedValue: null };
  }
  const ariaBooleanMatch = /^aria-([a-z0-9_-]+)$/.exec(variant);
  if (!ariaBooleanMatch?.[1]) return null;
  return { attributeName: `aria-${ariaBooleanMatch[1]}`, expectedValue: "true" };
};

const getStaticAttributePrimitiveValues = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null => {
  const stringValues = getJsxPropExhaustiveStaticStringValues(attribute, scopes);
  if (stringValues) return stringValues;
  if (
    attribute.value &&
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal") &&
    (typeof attribute.value.expression.value === "boolean" ||
      typeof attribute.value.expression.value === "number")
  ) {
    return [String(attribute.value.expression.value)];
  }
  return null;
};

const doesElementSatisfyTailwindLocalAttributeConstraint = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  constraint: TailwindLocalAttributeConstraint,
  scopes: ScopeAnalysis,
): boolean => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, constraint.attributeName, false);
  if (!attribute) return false;
  if (!attribute.value) return constraint.expectedValue === null;
  const values = getStaticAttributePrimitiveValues(attribute, scopes);
  if (!values) return false;
  if (constraint.expectedValue === null) {
    return values.some((value) => value !== "false");
  }
  return values.includes(constraint.expectedValue);
};

const isTailwindVariantSameElementAndSatisfiable = (
  variant: string,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (TAILWIND_PSEUDO_ELEMENT_VARIANTS.has(variant) || variant === "*" || variant === "**") {
    return false;
  }
  if (variant.startsWith("[")) return variant === "[&]";
  if (
    variant.startsWith("group-") ||
    variant.startsWith("peer-") ||
    variant.startsWith("has-") ||
    variant.startsWith("in-[")
  ) {
    return false;
  }
  const localAttributeConstraint = parseTailwindLocalAttributeConstraint(variant);
  if (!localAttributeConstraint) return true;
  return doesElementSatisfyTailwindLocalAttributeConstraint(node, localAttributeConstraint, scopes);
};

const isTailwindVariantScopeSameElementAndSatisfiable = (
  variantScope: ReadonlyArray<string>,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean =>
  variantScope.every((variant) =>
    isTailwindVariantSameElementAndSatisfiable(variant, node, scopes),
  );

const isMotionOwnershipCompatibleWithTailwindScope = (
  ownership: MotionOwnedPropertyEvidence,
  variantScope: ReadonlyArray<string>,
  availableVariantScopes: ReadonlyArray<ReadonlyArray<string>>,
): boolean => {
  if (variantScope.some((variant) => ownership.excludedTailwindVariants.has(variant))) {
    return false;
  }
  if (variantScope.length === 0 && ownership.activationTailwindVariant) {
    return !availableVariantScopes.some((availableVariantScope) =>
      availableVariantScope.includes(ownership.activationTailwindVariant ?? ""),
    );
  }
  return true;
};

const getMixedAnimationOwnerPropertyName = (
  className: string,
  styleExpression: EsTreeNodeOfType<"ObjectExpression"> | null,
  ownershipEvidence: ReadonlyArray<MotionOwnedPropertyEvidence>,
  reportNode: EsTreeNodeOfType<"JSXOpeningElement">,
  hasTailwindIndividualTransformProperties: boolean,
  scopes: ScopeAnalysis,
): string | null => {
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  const variantScopes = getTailwindVariantScopes(parsedTokens);
  const exhaustiveTransitionPartitions = getTailwindExhaustiveTransitionPartitions(
    parsedTokens,
    hasTailwindIndividualTransformProperties,
  );
  for (const variantScope of variantScopes) {
    if (!isTailwindVariantScopeSameElementAndSatisfiable(variantScope, reportNode, scopes)) {
      continue;
    }
    if (
      !doesTailwindScopeSelectExhaustiveTransitionBranches(
        variantScope,
        exhaustiveTransitionPartitions,
      )
    ) {
      continue;
    }
    const tailwindState = getTailwindTransitionState(
      className,
      variantScope,
      reportNode,
      hasTailwindIndividualTransformProperties,
    );
    if (!tailwindState) continue;
    const transitionEvidence = getEffectiveCssTransitionEvidence(
      styleExpression?.properties,
      tailwindState.defaultEvidence,
      {
        duration: tailwindState.isDurationImportant,
        property: tailwindState.isPropertyImportant,
      },
    );
    if (!transitionEvidence) continue;
    const conflictingOwnership = ownershipEvidence.find(
      (ownership) =>
        isMotionOwnershipCompatibleWithTailwindScope(ownership, variantScope, variantScopes) &&
        transitionEvidence.some(
          (transition) =>
            transition.propertyName !== "all" &&
            !transition.propertyName.startsWith("--") &&
            !NON_INTERPOLABLE_CSS_TRANSITION_PROPERTIES.has(transition.propertyName) &&
            transition.propertyName === ownership.propertyName &&
            transition.durationMilliseconds > 0,
        ),
    );
    if (conflictingOwnership) return conflictingOwnership.propertyName;
  }
  return null;
};

export const noMixedAnimationOwners = defineRule({
  id: "no-mixed-animation-owners",
  title: "CSS and Motion animate the same property",
  severity: "warn",
  category: "Design",
  defaultEnabled: false,
  tags: ["react-jsx-only"],
  recommendation:
    "Give each property one animation owner. Remove its CSS transition when Motion controls it, or move the CSS transition to a different element or property.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const ownershipEvidence = getMotionOwnedPropertyEvidence(node, context.scopes);
      if (!ownershipEvidence || ownershipEvidence.length === 0) return;
      const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className");
      let classNameValues: ReadonlyArray<string> | null = [""];
      if (classNameAttribute && hasCapabilityOrUnspecified(context.settings, "tailwind")) {
        classNameValues = getJsxPropExhaustiveStaticStringValues(
          classNameAttribute,
          context.scopes,
        );
      }
      if (!classNameValues) return;
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      const styleExpression = styleAttribute
        ? getInlineStyleExpression(styleAttribute, context.scopes)
        : null;
      if (styleAttribute && !styleExpression) return;
      const conflictingPropertyName = classNameValues
        .map((className) =>
          getMixedAnimationOwnerPropertyName(
            className,
            styleExpression,
            ownershipEvidence,
            node,
            hasCapability(context.settings, "tailwind:4"),
            context.scopes,
          ),
        )
        .find((propertyName): propertyName is string => propertyName !== null);
      if (!conflictingPropertyName) return;
      context.report({
        node,
        message: `Motion and CSS can both animate \`${conflictingPropertyName}\` on this element. Keep one animation owner per property to avoid retargeting and lag.`,
      });
    },
  }),
});
