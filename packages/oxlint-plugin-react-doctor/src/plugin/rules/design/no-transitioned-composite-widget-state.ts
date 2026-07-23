import { HTML_TAGS } from "../../constants/html-tags.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getHighestPriorityTailwindClassNameTokens } from "../../utils/get-highest-priority-tailwind-class-name-tokens.js";
import { getJsxPropExhaustiveStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getTailwindTopLevelCharacterIndices } from "../../utils/get-tailwind-top-level-character-indices.js";
import { getTailwindTransitionPropertyEffect } from "../../utils/get-tailwind-transition-property-effect.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { normalizeTailwindArbitraryUtilityValue } from "../../utils/normalize-tailwind-arbitrary-utility-value.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveTailwindTransitionDurationState } from "../../utils/resolve-tailwind-transition-duration-state.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getEffectiveCssTransitionEvidence } from "./utils/get-effective-css-transition-evidence.js";
import { getEffectiveStylePropertyAmong } from "./utils/get-effective-style-property-among.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";

interface CompositeWidgetRoleContract {
  stateNames: ReadonlySet<string>;
}

interface CompositeWidgetStateVariant {
  selectorValue: string;
  stateAttributeName: string;
  stateName: string;
}

interface TailwindPaintDeclaration {
  color: CanonicalPaintColor;
  propertyName: string;
}

interface CanonicalPaintColor {
  alpha: number;
  blue: number | null;
  green: number | null;
  red: number | null;
}

interface TailwindTransitionDefaults {
  hasPositiveDuration: boolean;
  propertyNames: ReadonlyArray<string>;
}

const COMPOSITE_WIDGET_ROLE_CONTRACTS: ReadonlyMap<string, CompositeWidgetRoleContract> = new Map([
  ["option", { stateNames: new Set(["current", "selected"]) }],
  ["menuitem", { stateNames: new Set(["current"]) }],
  ["menuitemcheckbox", { stateNames: new Set(["checked", "current"]) }],
  ["menuitemradio", { stateNames: new Set(["checked", "current"]) }],
  ["treeitem", { stateNames: new Set(["checked", "current", "selected"]) }],
]);
const STATE_ATTRIBUTE_NAMES: ReadonlyMap<string, string> = new Map([
  ["checked", "aria-checked"],
  ["current", "aria-current"],
  ["selected", "aria-selected"],
]);
const PAINT_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "background-color",
  "border-color",
  "color",
]);
const TRANSITION_COLORS_PROPERTY_NAMES = [
  "color",
  "background-color",
  "border-color",
  "text-decoration-color",
  "fill",
  "stroke",
];
const TRANSITION_DEFAULT_PROPERTY_NAMES = [
  ...TRANSITION_COLORS_PROPERTY_NAMES,
  "opacity",
  "box-shadow",
  "transform",
  "translate",
  "scale",
  "rotate",
  "filter",
  "backdrop-filter",
  "display",
  "content-visibility",
  "overlay",
  "pointer-events",
];
const NON_COLOR_BACKGROUND_PATTERN =
  /^bg-(?:auto|bottom|center|contain|cover|fixed|left(?:-bottom|-top)?|local|none|origin-|repeat|right(?:-bottom|-top)?|scroll|top|clip-|gradient-|linear-|radial|conic|blend-)/;
const NON_COLOR_TEXT_PATTERN =
  /^text-(?:left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|xs|sm|base|lg|xl|[2-9]xl|opacity-|shadow|shadow-|box|box-)/;
const NON_COLOR_BORDER_PATTERN =
  /^border-(?:0|2|4|8|x|y|t|r|b|l|s|e|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing|opacity)(?:-|$)/;
const ARBITRARY_LENGTH_PATTERN =
  /^\[(?:(?:length|percentage|absolute-size|relative-size):|(?:calc|min|max|clamp)\(|-?(?:\d*\.)?\d+(?:%|[a-z]+)\])/i;
const ARBITRARY_NON_COLOR_PATTERN =
  /^\[(?:image|url|position|length|size|angle|percentage|number|integer):/i;
const STATIC_COLOR_PATTERN =
  /^\[(?:color:)?(?:transparent|black|white|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\([^\]]+\))\]$/i;
const STATIC_ARBITRARY_COLOR_VALUE_PATTERN =
  /^(?:transparent|black|white|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(.+\))$/i;
const STATIC_RGB_COLOR_PATTERN =
  /^rgba?\(\s*\d+(?:\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+%?)?|\s+\d+\s+\d+(?:\s*\/\s*[\d.]+%?)?)\s*\)$/i;
const HEX_RADIX = 16;
const MAX_ALPHA_BYTE = 255;
const MAX_ALPHA_NIBBLE = 15;
const PERCENT_SCALE = 100;
const STABLE_STATE_CONTEXT_VARIANTS = new Set([
  "2xl",
  "contrast-less",
  "contrast-more",
  "dark",
  "landscape",
  "lg",
  "ltr",
  "md",
  "motion-reduce",
  "motion-safe",
  "portrait",
  "rtl",
  "sm",
  "xl",
]);
const ARIA_CURRENT_ACTIVE_VALUES = new Set(["date", "location", "page", "step", "time", "true"]);
const ARIA_BOOLEAN_ACTIVE_VALUES = new Set(["true"]);

const getRuntimeConditionParameter = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return getRuntimeConditionParameter(candidate.argument, context, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = context.scopes.referenceFor(candidate)?.resolvedSymbol;
  if (!symbol) return null;
  if (symbol.kind === "parameter") return symbol;
  if (symbol.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return getRuntimeConditionParameter(symbol.initializer, context, nextVisitedSymbolIds);
};

const getSelectorConditionParameter = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return getRuntimeConditionParameter(candidate.test, context);
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = context.scopes.referenceFor(candidate)?.resolvedSymbol;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return getSelectorConditionParameter(symbol.initializer, context, nextVisitedSymbolIds);
};

const expressionReferencesParameter = (
  expression: EsTreeNode,
  parameterSymbol: SymbolDescriptor,
  context: RuleContext,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  let doesReferenceParameter = false;
  walkAst(expression, (candidate) => {
    if (doesReferenceParameter) return false;
    if (candidate !== expression && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "Identifier")) return;
    const symbol = context.scopes.referenceFor(candidate)?.resolvedSymbol;
    if (!symbol) return;
    if (symbol === parameterSymbol) {
      doesReferenceParameter = true;
      return false;
    }
    if (symbol.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
      return;
    }
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    if (
      expressionReferencesParameter(
        symbol.initializer,
        parameterSymbol,
        context,
        nextVisitedSymbolIds,
      )
    ) {
      doesReferenceParameter = true;
      return false;
    }
  });
  return doesReferenceParameter;
};

const hasStableElementKey = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  parameterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const keyAttribute = getAuthoritativeJsxAttribute(node.attributes, "key", false);
  if (!keyAttribute?.value || !isNodeOfType(keyAttribute.value, "JSXExpressionContainer")) {
    return true;
  }
  return !expressionReferencesParameter(keyAttribute.value.expression, parameterSymbol, context);
};

const isMountedWithinSelectorBranch = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  parameterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let ancestor = node.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      ((isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) &&
        expressionReferencesParameter(ancestor.test, parameterSymbol, context)) ||
      (isNodeOfType(ancestor, "LogicalExpression") &&
        expressionReferencesParameter(ancestor.left, parameterSymbol, context))
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const canBothConditionOutcomesReachElement = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  parameterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (
    parameterSymbol.references.some((reference) => reference.flag !== "read") ||
    !hasStableElementKey(node, parameterSymbol, context) ||
    !context.cfg.isUnconditionalFromEntry(node) ||
    isMountedWithinSelectorBranch(node, parameterSymbol, context) ||
    isGatedByFalsyInitialState(node, context.scopes)
  ) {
    return false;
  }
  return true;
};

const getExhaustiveAttributeValues = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
  context: RuleContext,
): ReadonlySet<string> | null => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName, false);
  if (!attribute) return null;
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return null;
  }
  const parameterSymbol = getSelectorConditionParameter(attribute.value.expression, context);
  if (!parameterSymbol || !canBothConditionOutcomesReachElement(node, parameterSymbol, context)) {
    return null;
  }
  const values = getJsxPropExhaustiveStaticStringValues(attribute, context.scopes);
  return values ? new Set(values.map((value) => value.trim())) : null;
};

const canAttributeSelectorActivationVary = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
  selectorValue: string,
  context: RuleContext,
): boolean => {
  const values = getExhaustiveAttributeValues(node, attributeName, context);
  return Boolean(
    values?.has(selectorValue) && [...values].some((value) => value !== selectorValue),
  );
};

const canAriaStateVary = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  stateVariant: CompositeWidgetStateVariant,
  context: RuleContext,
): boolean => {
  const values = getExhaustiveAttributeValues(node, stateVariant.stateAttributeName, context);
  if (!values) return false;
  const activeValues =
    stateVariant.stateName === "current" ? ARIA_CURRENT_ACTIVE_VALUES : ARIA_BOOLEAN_ACTIVE_VALUES;
  return (
    [...values].some((value) => activeValues.has(value)) &&
    [...values].some((value) => !activeValues.has(value))
  );
};

const getCompositeWidgetRole = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): string | null => {
  const roleAttribute = getAuthoritativeJsxAttribute(node.attributes, "role", false);
  if (!roleAttribute) return null;
  const roleCandidates = getJsxPropStaticStringValues(roleAttribute, context.scopes);
  if (!roleCandidates) return null;
  const normalizedRoles = new Set(
    roleCandidates.map((candidate) => candidate.trim().toLowerCase()),
  );
  if (normalizedRoles.size !== 1) return null;
  const role = normalizedRoles.values().next().value;
  if (!role || role.split(/\s+/).length !== 1 || !COMPOSITE_WIDGET_ROLE_CONTRACTS.has(role)) {
    return null;
  }
  return role;
};

const parseCompositeWidgetStateVariant = (variant: string): CompositeWidgetStateVariant | null => {
  for (const [stateName, stateAttributeName] of STATE_ATTRIBUTE_NAMES) {
    if (
      variant === `aria-${stateName}` ||
      variant === `aria-[${stateName}=true]` ||
      (stateName === "current" &&
        /^aria-\[current=(?:page|step|location|date|time)\]$/.test(variant))
    ) {
      const selectorValue = /^aria-\[[^=]+=([^\]]+)\]$/.exec(variant)?.[1] ?? "true";
      return { selectorValue, stateAttributeName, stateName };
    }
  }
  return null;
};

const getStateVariant = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  role: string,
  variants: ReadonlyArray<string>,
  context: RuleContext,
): CompositeWidgetStateVariant | null => {
  const stateVariants = variants.flatMap((variant) => {
    const stateVariant = parseCompositeWidgetStateVariant(variant);
    return stateVariant ? [stateVariant] : [];
  });
  if (stateVariants.length !== 1) return null;
  if (
    variants.some(
      (variant) =>
        parseCompositeWidgetStateVariant(variant) === null &&
        !STABLE_STATE_CONTEXT_VARIANTS.has(variant),
    )
  ) {
    return null;
  }
  const stateVariant = stateVariants[0];
  const roleContract = COMPOSITE_WIDGET_ROLE_CONTRACTS.get(role);
  if (!stateVariant || !roleContract?.stateNames.has(stateVariant.stateName)) return null;
  if (!canAriaStateVary(node, stateVariant, context)) return null;
  if (
    !canAttributeSelectorActivationVary(
      node,
      stateVariant.stateAttributeName,
      stateVariant.selectorValue,
      context,
    )
  ) {
    return null;
  }
  return stateVariant;
};

const splitUtilityOpacityModifier = (utility: string): [string, string | null] => {
  const modifierIndex = getTailwindTopLevelCharacterIndices(
    utility,
    (character) => character === "/",
  )[0];
  return modifierIndex === undefined
    ? [utility, null]
    : [utility.slice(0, modifierIndex), utility.slice(modifierIndex + 1)];
};

const parseAlpha = (rawAlpha: string): number | null => {
  if (!/^\d*\.?\d+%?$/.test(rawAlpha)) return null;
  const alpha = Number.parseFloat(rawAlpha);
  if (!Number.isFinite(alpha)) return null;
  const normalizedAlpha = rawAlpha.endsWith("%") ? alpha / PERCENT_SCALE : alpha;
  return normalizedAlpha >= 0 && normalizedAlpha <= 1 ? normalizedAlpha : null;
};

const getColorFunctionAlpha = (value: string): number | null => {
  const functionBody = /^rgba?\((.*)\)$/i.exec(value)?.[1];
  if (!functionBody) return null;
  const slashAlpha = /\/\s*([\d.]+%?)\s*$/.exec(functionBody)?.[1];
  if (slashAlpha) return parseAlpha(slashAlpha);
  const commaParts = functionBody.split(",").map((part) => part.trim());
  if (commaParts.length === 4 && commaParts[3]) return parseAlpha(commaParts[3]);
  return 1;
};

const getHexAlpha = (value: string): number | null => {
  const hex = value.slice(1);
  if (hex.length === 3 || hex.length === 6) return 1;
  if (hex.length === 4) return Number.parseInt(hex[3] ?? "", HEX_RADIX) / MAX_ALPHA_NIBBLE;
  if (hex.length === 8) {
    return Number.parseInt(hex.slice(6), HEX_RADIX) / MAX_ALPHA_BYTE;
  }
  return null;
};

const getOpacityModifier = (rawModifier: string | null): number | null => {
  if (rawModifier === null) return 1;
  const arbitraryModifier = /^\[([\d.]+%?)\]$/.exec(rawModifier)?.[1];
  if (arbitraryModifier) return parseAlpha(arbitraryModifier);
  if (!/^\d*\.?\d+$/.test(rawModifier)) return null;
  return parseAlpha(`${rawModifier}%`);
};

const getCanonicalPaintColor = (
  rawValue: string,
  rawOpacityModifier: string | null,
): CanonicalPaintColor | null => {
  const opacityModifier = getOpacityModifier(rawOpacityModifier);
  if (opacityModifier === null) return null;
  const normalizedValue = normalizeTailwindArbitraryUtilityValue(rawValue).toLowerCase();
  if (normalizedValue === "transparent") {
    return { alpha: 0, blue: 0, green: 0, red: 0 };
  }
  if (normalizedValue === "white") {
    return {
      alpha: opacityModifier,
      blue: MAX_ALPHA_BYTE,
      green: MAX_ALPHA_BYTE,
      red: MAX_ALPHA_BYTE,
    };
  }
  if (normalizedValue === "black") {
    return { alpha: opacityModifier, blue: 0, green: 0, red: 0 };
  }
  const unwrappedArbitraryValue = /^\[(?:color:)?(.+)\]$/.exec(normalizedValue)?.[1];
  const cssColor = unwrappedArbitraryValue ?? normalizedValue;
  if (cssColor.startsWith("#") || STATIC_RGB_COLOR_PATTERN.test(cssColor)) {
    const rgb = parseColorToRgb(cssColor);
    const colorAlpha = cssColor.startsWith("#")
      ? getHexAlpha(cssColor)
      : getColorFunctionAlpha(cssColor);
    if (
      !rgb ||
      colorAlpha === null ||
      rgb.red > MAX_ALPHA_BYTE ||
      rgb.green > MAX_ALPHA_BYTE ||
      rgb.blue > MAX_ALPHA_BYTE
    ) {
      return null;
    }
    return {
      alpha: colorAlpha * opacityModifier,
      blue: rgb.blue,
      green: rgb.green,
      red: rgb.red,
    };
  }
  return null;
};

const getArbitraryPropertyDeclaration = (utility: string): TailwindPaintDeclaration | null => {
  const match = /^\[(background-color|border-color|color):(.+)\]$/i.exec(utility);
  if (!match?.[1] || !match[2]) return null;
  const value = normalizeTailwindArbitraryUtilityValue(match[2]).toLowerCase();
  if (!STATIC_ARBITRARY_COLOR_VALUE_PATTERN.test(value)) return null;
  const color = getCanonicalPaintColor(value, null);
  if (!color) return null;
  return {
    color,
    propertyName: match[1].toLowerCase(),
  };
};

const getTailwindPaintDeclaration = (utility: string): TailwindPaintDeclaration | null => {
  const arbitraryProperty = getArbitraryPropertyDeclaration(utility);
  if (arbitraryProperty) return arbitraryProperty;
  const [utilityWithoutModifier, opacityModifier] = splitUtilityOpacityModifier(utility);
  const utilityParts = utilityWithoutModifier.split("-");
  const prefix = utilityParts[0];
  const rawValue = utilityWithoutModifier.slice((prefix?.length ?? 0) + 1);
  if (!prefix || !rawValue) return null;
  const color = getCanonicalPaintColor(rawValue, opacityModifier);
  if (!color) return null;
  if (prefix === "bg") {
    if (
      NON_COLOR_BACKGROUND_PATTERN.test(utilityWithoutModifier) ||
      ARBITRARY_NON_COLOR_PATTERN.test(rawValue)
    ) {
      return null;
    }
    if (!STATIC_COLOR_PATTERN.test(rawValue)) return null;
    return { color, propertyName: "background-color" };
  }
  if (prefix === "text") {
    if (
      NON_COLOR_TEXT_PATTERN.test(utilityWithoutModifier) ||
      ARBITRARY_LENGTH_PATTERN.test(rawValue)
    ) {
      return null;
    }
    if (!STATIC_COLOR_PATTERN.test(rawValue)) return null;
    return { color, propertyName: "color" };
  }
  if (prefix === "border") {
    if (NON_COLOR_BORDER_PATTERN.test(utilityWithoutModifier)) return null;
    if (!STATIC_COLOR_PATTERN.test(rawValue)) return null;
    return { color, propertyName: "border-color" };
  }
  return null;
};

const areCanonicalColorsEquivalent = (
  leftColor: CanonicalPaintColor,
  rightColor: CanonicalPaintColor,
): boolean => {
  if (leftColor.alpha === 0 && rightColor.alpha === 0) return true;
  return (
    leftColor.red === rightColor.red &&
    leftColor.green === rightColor.green &&
    leftColor.blue === rightColor.blue &&
    leftColor.alpha === rightColor.alpha
  );
};

const areCanonicalColorsProvablyDistinct = (
  leftColor: CanonicalPaintColor,
  rightColor: CanonicalPaintColor,
): boolean => {
  if (areCanonicalColorsEquivalent(leftColor, rightColor)) return false;
  return true;
};

const getEffectiveStatePaintProperty = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  role: string,
  rawTokens: ReadonlyArray<string>,
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  context: RuleContext,
): TailwindPaintDeclaration | null => {
  for (const parsedToken of parsedTokens) {
    const stateVariant = getStateVariant(node, role, parsedToken.variants, context);
    const stateDeclaration = getTailwindPaintDeclaration(parsedToken.utility);
    if (!stateVariant || !stateDeclaration || parsedToken.isImportant) continue;
    const propertyPredicate = (utility: string): boolean =>
      getTailwindPaintDeclaration(utility)?.propertyName === stateDeclaration.propertyName;
    const effectiveState = resolveEffectiveTailwindClassNameToken(
      [...rawTokens],
      propertyPredicate,
      parsedToken.variants,
    );
    if (
      effectiveState.isAmbiguous ||
      effectiveState.isImportant ||
      effectiveState.utility !== parsedToken.utility
    ) {
      continue;
    }
    const restingTokens: string[] = [];
    for (const candidate of parsedTokens) {
      if (candidate.variants.some((variant) => parseCompositeWidgetStateVariant(variant))) {
        continue;
      }
      restingTokens.push(
        `${candidate.variants.map((variant) => `${variant}:`).join("")}${
          candidate.isImportant ? "!" : ""
        }${candidate.utility}`,
      );
    }
    const restingState = resolveEffectiveTailwindClassNameToken(
      restingTokens,
      propertyPredicate,
      parsedToken.variants,
    );
    if (restingState.isAmbiguous || restingState.isImportant) continue;
    const restingDeclaration = restingState.utility
      ? getTailwindPaintDeclaration(restingState.utility)
      : null;
    if (
      !restingDeclaration ||
      !areCanonicalColorsProvablyDistinct(restingDeclaration.color, stateDeclaration.color)
    ) {
      continue;
    }
    return stateDeclaration;
  }
  return null;
};

const getTransitionPropertyNames = (utility: string): ReadonlyArray<string> | null => {
  if (utility === "transition-colors") return TRANSITION_COLORS_PROPERTY_NAMES;
  if (utility === "transition") return TRANSITION_DEFAULT_PROPERTY_NAMES;
  return getTailwindTransitionPropertyEffect(utility)?.propertyNames ?? null;
};

const isTransitionDurationSetter = (utility: string): boolean =>
  utility.startsWith("duration-") ||
  utility.startsWith("[transition-duration:") ||
  utility.startsWith("[transition:");

const transitionUtilityHasDefaultDuration = (utility: string): boolean =>
  utility === "transition" ||
  utility === "transition-colors" ||
  (utility.startsWith("transition-[") && utility.endsWith("]"));

const getTailwindTransitionDefaults = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
): TailwindTransitionDefaults | null => {
  const propertyTokens = getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope) &&
      getTailwindTransitionPropertyEffect(parsedToken.utility) !== null,
  );
  if (propertyTokens.some((parsedToken) => parsedToken.isImportant)) return null;
  const propertyNameLists = propertyTokens.map((parsedToken) =>
    getTransitionPropertyNames(parsedToken.utility),
  );
  if (propertyNameLists.some((propertyNames) => propertyNames === null)) return null;
  const serializedPropertyNameLists = new Set(
    propertyNameLists.map((propertyNames) => JSON.stringify(propertyNames)),
  );
  if (serializedPropertyNameLists.size > 1) return null;
  const propertyNames = propertyNameLists[0] ?? ["all"];
  const relevantDurationTokens = parsedTokens.filter(
    (parsedToken) =>
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope) &&
      isTransitionDurationSetter(parsedToken.utility),
  );
  if (relevantDurationTokens.some((parsedToken) => parsedToken.isImportant)) return null;
  const targetPropertyNames = new Set(
    propertyNames.filter((propertyName) => PAINT_PROPERTY_NAMES.has(propertyName)),
  );
  if (targetPropertyNames.size === 0) targetPropertyNames.add("all");
  const durationState = resolveTailwindTransitionDurationState(
    parsedTokens,
    targetVariantScope,
    targetPropertyNames,
  );
  if (durationState !== null) return { hasPositiveDuration: durationState, propertyNames };
  if (relevantDurationTokens.length > 0) return null;
  const hasDefaultDuration = propertyTokens.some((parsedToken) =>
    transitionUtilityHasDefaultDuration(parsedToken.utility),
  );
  return { hasPositiveDuration: hasDefaultDuration, propertyNames };
};

const hasTransitionedPaintProperty = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  targetPropertyName: string,
  context: RuleContext,
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
  const styleExpression = styleAttribute
    ? getInlineStyleExpression(styleAttribute, context.scopes)
    : null;
  if (styleAttribute && !styleExpression) return false;
  let paintStylePropertyNames = new Set(["color"]);
  if (targetPropertyName === "background-color") {
    paintStylePropertyNames = new Set(["background", "backgroundColor"]);
  } else if (targetPropertyName === "border-color") {
    paintStylePropertyNames = new Set(["border", "borderColor"]);
  }
  if (getEffectiveStylePropertyAmong(styleExpression?.properties, paintStylePropertyNames)) {
    return false;
  }
  const transitionDefaults = getTailwindTransitionDefaults(parsedTokens, targetVariantScope);
  if (!transitionDefaults) return false;
  const transitionEvidence = getEffectiveCssTransitionEvidence(
    styleExpression?.properties,
    transitionDefaults.propertyNames.map((propertyName) => ({
      hasPositiveDuration: transitionDefaults.hasPositiveDuration,
      propertyName,
      sourceNode: node,
    })),
  );
  return Boolean(
    transitionEvidence?.some(
      (transition) =>
        transition.propertyName === targetPropertyName && transition.durationMilliseconds > 0,
    ),
  );
};

export const noTransitionedCompositeWidgetState = defineRule({
  id: "no-transitioned-composite-widget-state",
  title: "Composite widget state feedback is delayed",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  tags: ["react-jsx-only", "test-noise"],
  requires: ["tailwind"],
  recommendation:
    "Keep selected, checked, and current-item color feedback instant in options, menus, and trees. Reserve transitions for the widget container opening or closing.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        hasJsxSpreadAttribute(node.attributes) ||
        !isProvenIntrinsicJsxElement(node, context.scopes) ||
        !HTML_TAGS.has(getElementType(node, context.settings))
      ) {
        return;
      }
      const role = getCompositeWidgetRole(node, context);
      const className = getStringFromClassNameAttr(node);
      if (!role || !className) return;
      const rawTokens = splitTailwindClassName(className);
      const parsedTokens = rawTokens.map(parseTailwindClassNameToken);
      const statePaintDeclaration = getEffectiveStatePaintProperty(
        node,
        role,
        rawTokens,
        parsedTokens,
        context,
      );
      if (!statePaintDeclaration) return;
      const stateToken = parsedTokens.find((parsedToken) => {
        const declaration = getTailwindPaintDeclaration(parsedToken.utility);
        return (
          declaration?.propertyName === statePaintDeclaration.propertyName &&
          areCanonicalColorsEquivalent(declaration.color, statePaintDeclaration.color) &&
          getStateVariant(node, role, parsedToken.variants, context) !== null
        );
      });
      if (
        !stateToken ||
        !hasTransitionedPaintProperty(
          node,
          parsedTokens,
          stateToken.variants,
          statePaintDeclaration.propertyName,
          context,
        )
      ) {
        return;
      }
      context.report({
        node,
        message: `The ${role} transitions its ${statePaintDeclaration.propertyName} when its state changes. Keep high-frequency composite-widget feedback instant.`,
      });
    },
  }),
});
