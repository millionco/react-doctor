import { TAILWIND_BREAKPOINT_NAMES } from "../../constants/tailwind.js";
import { defineRule } from "../../utils/define-rule.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getHighestPriorityTailwindClassNameTokens } from "../../utils/get-highest-priority-tailwind-class-name-tokens.js";
import { getMotionReactApiPath } from "../../utils/get-motion-react-api-path.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { getTailwindVisibilityEffect } from "../../utils/get-tailwind-visibility-effect.js";
import type { TailwindVisibilityEffect } from "../../utils/get-tailwind-visibility-effect.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTailwindMotionSafeVariant } from "../../utils/is-tailwind-motion-safe-variant.js";
import { isTailwindReducedMotionVariant } from "../../utils/is-tailwind-reduced-motion-variant.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "../design/utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "../design/utils/get-style-property-string-value.js";

const LIVE_REGION_ROLES: ReadonlySet<string> = new Set(["alert", "log", "status"]);
const NEUTRAL_FALLBACK_WRAPPER_TAGS: ReadonlySet<string> = new Set(["div", "section", "span"]);
const PRESENTATIONAL_ROLES: ReadonlySet<string> = new Set(["none", "presentation"]);
const STATIC_TEXT_PATTERN = /[\p{L}\p{N}]/u;
const VISIBLE_DISPLAY_VALUES: ReadonlySet<string> = new Set([
  "block",
  "contents",
  "flex",
  "flow-root",
  "grid",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "inline-table",
  "list-item",
  "table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row",
  "table-row-group",
]);

interface StaticAttributeResolution {
  status: "absent" | "known" | "unknown";
  value: string;
}

interface StaticBooleanAttributeResolution {
  status: "absent" | "known" | "unknown";
  value: boolean;
}

interface SemanticIdentityResolution {
  status: "absent" | "known" | "unknown";
  value: string;
}

interface SemanticSummary {
  actionIdentities: string[];
  hasUnknownSemantics: boolean;
  liveRegionIdentities: string[];
  staticTextParts: string[];
}

const createSemanticSummary = (): SemanticSummary => ({
  actionIdentities: [],
  hasUnknownSemantics: false,
  liveRegionIdentities: [],
  staticTextParts: [],
});

const mergeSemanticSummary = (target: SemanticSummary, source: SemanticSummary): void => {
  target.actionIdentities.push(...source.actionIdentities);
  target.liveRegionIdentities.push(...source.liveRegionIdentities);
  target.staticTextParts.push(...source.staticTextParts);
  target.hasUnknownSemantics ||= source.hasUnknownSemantics;
};

const normalizeStaticText = (textParts: ReadonlyArray<string>): string =>
  textParts.join(" ").replace(/\s+/g, " ").trim();

const getStaticTextFromJsxChild = (child: EsTreeNode): StaticAttributeResolution => {
  if (isNodeOfType(child, "JSXText")) {
    return { status: "known", value: child.value };
  }
  if (!isNodeOfType(child, "JSXExpressionContainer")) {
    return { status: "absent", value: "" };
  }
  const expression = stripParenExpression(child.expression);
  if (isNodeOfType(expression, "JSXEmptyExpression")) {
    return { status: "known", value: "" };
  }
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string" || typeof expression.value === "number") {
      return { status: "known", value: String(expression.value) };
    }
    if (typeof expression.value === "bigint") {
      return { status: "known", value: expression.value.toString() };
    }
    if (
      expression.value === null ||
      typeof expression.value === "boolean" ||
      expression.value === undefined
    ) {
      return { status: "known", value: "" };
    }
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const value = getStaticTemplateLiteralValue(expression);
    return value === null ? { status: "unknown", value: "" } : { status: "known", value };
  }
  return { status: "unknown", value: "" };
};

const getStaticAttributeResolution = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): StaticAttributeResolution => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return { status: "absent", value: "" };
  if (!attribute.value) return { status: "unknown", value: "" };
  if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string") {
    return { status: "known", value: attribute.value.value };
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return { status: "unknown", value: "" };
  }
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return { status: "known", value: expression.value };
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const value = getStaticTemplateLiteralValue(expression);
    return value === null ? { status: "unknown", value: "" } : { status: "known", value };
  }
  return { status: "unknown", value: "" };
};

const getStaticBooleanAttributeResolution = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): StaticBooleanAttributeResolution => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return { status: "absent", value: false };
  if (!attribute.value) return { status: "known", value: true };
  if (isNodeOfType(attribute.value, "Literal")) {
    return { status: "known", value: Boolean(attribute.value.value) };
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return { status: "unknown", value: false };
  }
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    return { status: "known", value: Boolean(expression.value) };
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const value = getStaticTemplateLiteralValue(expression);
    return value === null
      ? { status: "unknown", value: false }
      : { status: "known", value: Boolean(value) };
  }
  return { status: "unknown", value: false };
};

const getAriaHiddenResolution = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticBooleanAttributeResolution => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, "aria-hidden", false);
  if (!attribute) return { status: "absent", value: false };
  if (!attribute.value) return { status: "known", value: true };
  if (isNodeOfType(attribute.value, "Literal")) {
    if (typeof attribute.value.value === "boolean") {
      return { status: "known", value: attribute.value.value };
    }
    if (typeof attribute.value.value === "string") {
      return { status: "known", value: attribute.value.value.toLowerCase() === "true" };
    }
    return { status: "unknown", value: false };
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return { status: "unknown", value: false };
  }
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "boolean") {
      return { status: "known", value: expression.value };
    }
    if (typeof expression.value === "string") {
      return { status: "known", value: expression.value.toLowerCase() === "true" };
    }
  }
  return { status: "unknown", value: false };
};

const getInlineStylePropertyVisibility = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  propertyName: TailwindVisibilityEffect["propertyName"],
  context: RuleContext,
): "hidden" | "unknown" | "unset" | "visible" => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style", false);
  if (!styleAttribute) return "unset";
  const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
  if (
    !styleExpression ||
    styleExpression.properties.some((property) => getStylePropertyKey(property) === null)
  ) {
    return "unknown";
  }
  const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
  if (!property) return "unset";
  const value = getStylePropertyStringValue(property)?.trim().toLowerCase();
  if (!value) return "unknown";
  if (propertyName === "display") {
    if (value === "none") return "hidden";
    return VISIBLE_DISPLAY_VALUES.has(value) ? "visible" : "unknown";
  }
  if (value === "hidden" || value === "collapse") return "hidden";
  return value === "visible" ? "visible" : "unknown";
};

const getEffectiveTailwindVisibilityOverride = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  propertyName: TailwindVisibilityEffect["propertyName"],
): boolean | null | undefined => {
  const effectiveTokens = getHighestPriorityTailwindClassNameTokens(parsedTokens, (parsedToken) => {
    const resolution = getTailwindVisibilityEffect(parsedToken.utility);
    return (
      resolution.propertyName === propertyName &&
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope)
    );
  });
  if (effectiveTokens.length === 0) return undefined;
  const effectiveStates = new Set<boolean>();
  for (const token of effectiveTokens) {
    const resolution = getTailwindVisibilityEffect(token.utility);
    if (resolution.status !== "known" || resolution.isVisible === null) return null;
    effectiveStates.add(resolution.isVisible);
  }
  return effectiveStates.size === 1 ? (effectiveStates.values().next().value ?? null) : null;
};

const getEffectiveTailwindVisibility = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  propertyName: TailwindVisibilityEffect["propertyName"],
): boolean | null => {
  const visibility = getEffectiveTailwindVisibilityOverride(
    parsedTokens,
    targetVariantScope,
    propertyName,
  );
  return visibility === undefined ? true : visibility;
};

const isSupportedSatisfiableReducedMotionScope = (variants: ReadonlyArray<string>): boolean => {
  if (
    variants.some((variant) => {
      if (isTailwindReducedMotionVariant(variant) || isTailwindMotionSafeVariant(variant)) {
        return variant !== "motion-reduce" && variant !== "motion-safe";
      }
      if (TAILWIND_BREAKPOINT_NAMES.indexOf(variant) > 0) return false;
      return (
        !variant.startsWith("max-") ||
        TAILWIND_BREAKPOINT_NAMES.indexOf(variant.slice("max-".length)) <= 0
      );
    })
  ) {
    return false;
  }
  if (variants.some(isTailwindReducedMotionVariant) && variants.some(isTailwindMotionSafeVariant)) {
    return false;
  }
  const normalizedVariants = new Set(variants.map((variant) => variant.split("/")[0]));
  if (
    [...normalizedVariants].some(
      (variant) =>
        variant.startsWith("not-") && normalizedVariants.has(variant.slice("not-".length)),
    )
  ) {
    return false;
  }
  let minimumBreakpointIndex = 0;
  let maximumBreakpointIndex = TAILWIND_BREAKPOINT_NAMES.length;
  for (const variant of variants) {
    const minimumVariantIndex = TAILWIND_BREAKPOINT_NAMES.indexOf(variant);
    if (minimumVariantIndex > 0) {
      minimumBreakpointIndex = Math.max(minimumBreakpointIndex, minimumVariantIndex);
      continue;
    }
    if (!variant.startsWith("max-")) continue;
    const maximumVariantIndex = TAILWIND_BREAKPOINT_NAMES.indexOf(variant.slice("max-".length));
    if (maximumVariantIndex > 0) {
      maximumBreakpointIndex = Math.min(maximumBreakpointIndex, maximumVariantIndex);
    }
  }
  return minimumBreakpointIndex < maximumBreakpointIndex;
};

const getEffectiveReducedMotionScopes = (className: string): string[][] => {
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  const reducedMotionScopes: string[][] = [];
  const seenVariantScopes = new Set<string>();
  for (const token of parsedTokens) {
    if (
      (token.utility !== "hidden" && token.utility !== "invisible") ||
      !token.variants.some(isTailwindReducedMotionVariant) ||
      !isSupportedSatisfiableReducedMotionScope(token.variants)
    ) {
      continue;
    }
    const propertyName = token.utility === "hidden" ? "display" : "visibility";
    if (getEffectiveTailwindVisibility(parsedTokens, token.variants, propertyName) !== false) {
      continue;
    }
    const variantScopeKey = token.variants.join(":");
    if (seenVariantScopes.has(variantScopeKey)) continue;
    seenVariantScopes.add(variantScopeKey);
    reducedMotionScopes.push([...token.variants]);
  }
  return reducedMotionScopes;
};

const getProvenIntrinsicTagName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return null;
  return openingElement.name.name === openingElement.name.name.toLowerCase()
    ? openingElement.name.name
    : null;
};

const getElementNonTailwindVisibility = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): "hidden" | "unknown" | "visible" => {
  const tagName = getProvenIntrinsicTagName(openingElement);
  if (!tagName) return "unknown";
  if (hasJsxSpreadAttribute(openingElement.attributes)) return "unknown";
  const hiddenResolution = getStaticBooleanAttributeResolution(openingElement, "hidden");
  if (hiddenResolution.status === "unknown") return "unknown";
  if (hiddenResolution.status === "known" && hiddenResolution.value) return "hidden";
  const ariaHiddenResolution = getAriaHiddenResolution(openingElement);
  if (ariaHiddenResolution.status === "unknown") return "unknown";
  if (ariaHiddenResolution.status === "known" && ariaHiddenResolution.value) return "hidden";
  if (tagName === "input") {
    const typeResolution = getStaticAttributeResolution(openingElement, "type");
    if (typeResolution.status === "unknown") return "unknown";
    if (typeResolution.status === "known" && typeResolution.value.toLowerCase() === "hidden") {
      return "hidden";
    }
  }
  const displayVisibility = getInlineStylePropertyVisibility(openingElement, "display", context);
  const visibilityVisibility = getInlineStylePropertyVisibility(
    openingElement,
    "visibility",
    context,
  );
  if (displayVisibility === "unknown" || visibilityVisibility === "unknown") return "unknown";
  if (displayVisibility === "hidden" || visibilityVisibility === "hidden") return "hidden";
  return "visible";
};

const getElementVisibilityInScope = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): "hidden" | "unknown" | "visible" => {
  const nonTailwindVisibility = getElementNonTailwindVisibility(openingElement, context);
  if (nonTailwindVisibility !== "visible") return nonTailwindVisibility;
  const classNameAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "className");
  if (!classNameAttribute) return "visible";
  const className = getStringFromClassNameAttr(openingElement);
  if (className === null) return "unknown";
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  const displayVisibility = getEffectiveTailwindVisibility(
    parsedTokens,
    targetVariantScope,
    "display",
  );
  const visibilityVisibility = getEffectiveTailwindVisibility(
    parsedTokens,
    targetVariantScope,
    "visibility",
  );
  if (displayVisibility === null || visibilityVisibility === null) return "unknown";
  return displayVisibility && visibilityVisibility ? "visible" : "hidden";
};

const getExplicitElementVisibilityOverride = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): "hidden" | "unknown" | "unset" | "visible" => {
  if (!getProvenIntrinsicTagName(openingElement)) return "unknown";
  if (hasJsxSpreadAttribute(openingElement.attributes)) return "unknown";
  const inlineVisibility = getInlineStylePropertyVisibility(openingElement, "visibility", context);
  const classNameAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "className");
  if (!classNameAttribute) return inlineVisibility;
  const className = getStringFromClassNameAttr(openingElement);
  if (className === null) return "unknown";
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  const tailwindVisibility = getEffectiveTailwindVisibilityOverride(
    parsedTokens,
    targetVariantScope,
    "visibility",
  );
  if (tailwindVisibility === null || inlineVisibility === "unknown") return "unknown";
  if (tailwindVisibility === undefined) return inlineVisibility;
  const tailwindState = tailwindVisibility ? "visible" : "hidden";
  if (inlineVisibility === "unset" || inlineVisibility === tailwindState) return tailwindState;
  return "unknown";
};

const getDescendantVisibilityEscape = (
  children: ReadonlyArray<EsTreeNode>,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): "absent" | "present" | "unknown" => {
  let hasUnknownEscape = false;
  for (const child of children) {
    if (isNodeOfType(child, "JSXElement")) {
      const tagName = getProvenIntrinsicTagName(child.openingElement);
      if (!tagName) {
        hasUnknownEscape = true;
        continue;
      }
      if (tagName === "template") continue;
      const visibilityOverride = getExplicitElementVisibilityOverride(
        child.openingElement,
        targetVariantScope,
        context,
      );
      if (visibilityOverride === "visible") return "present";
      if (visibilityOverride === "unknown") hasUnknownEscape = true;
      const descendantEscape = getDescendantVisibilityEscape(
        child.children,
        targetVariantScope,
        context,
      );
      if (descendantEscape === "present") return "present";
      if (descendantEscape === "unknown") hasUnknownEscape = true;
      continue;
    }
    if (isNodeOfType(child, "JSXFragment")) {
      const descendantEscape = getDescendantVisibilityEscape(
        child.children,
        targetVariantScope,
        context,
      );
      if (descendantEscape === "present") return "present";
      if (descendantEscape === "unknown") hasUnknownEscape = true;
      continue;
    }
    const textResolution = getStaticTextFromJsxChild(child);
    if (textResolution.status === "unknown") hasUnknownEscape = true;
  }
  return hasUnknownEscape ? "unknown" : "absent";
};

const getNormalMotionScope = (reducedMotionScope: ReadonlyArray<string>): string[] =>
  reducedMotionScope.map((variant) =>
    isTailwindReducedMotionVariant(variant) ? "motion-safe" : variant,
  );

const isRootAndAncestorsVisibleBeforeRemoval = (
  element: EsTreeNodeOfType<"JSXElement">,
  reducedMotionScope: ReadonlyArray<string>,
  context: RuleContext,
): boolean => {
  const normalMotionScope = getNormalMotionScope(reducedMotionScope);
  if (
    getElementVisibilityInScope(element.openingElement, normalMotionScope, context) !== "visible"
  ) {
    return false;
  }
  let ancestor: EsTreeNode | null | undefined = element.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      if (
        getElementVisibilityInScope(ancestor.openingElement, normalMotionScope, context) !==
          "visible" ||
        getElementVisibilityInScope(ancestor.openingElement, reducedMotionScope, context) !==
          "visible"
      ) {
        return false;
      }
    }
    ancestor = ancestor.parent;
    if (
      ancestor &&
      (isNodeOfType(ancestor, "ReturnStatement") ||
        isNodeOfType(ancestor, "ArrowFunctionExpression"))
    ) {
      break;
    }
  }
  return true;
};

const getInteractiveName = (
  element: EsTreeNodeOfType<"JSXElement">,
  childSummary: SemanticSummary,
): SemanticIdentityResolution => {
  if (getAuthoritativeJsxAttribute(element.openingElement.attributes, "aria-labelledby", false)) {
    return { status: "unknown", value: "" };
  }
  const ariaLabelResolution = getStaticAttributeResolution(element.openingElement, "aria-label");
  if (ariaLabelResolution.status === "unknown") return { status: "unknown", value: "" };
  if (ariaLabelResolution.status === "known") {
    const label = ariaLabelResolution.value.trim();
    return label ? { status: "known", value: label } : { status: "unknown", value: "" };
  }
  if (childSummary.hasUnknownSemantics) return { status: "unknown", value: "" };
  const text = normalizeStaticText(childSummary.staticTextParts);
  return STATIC_TEXT_PATTERN.test(text)
    ? { status: "known", value: text }
    : { status: "unknown", value: "" };
};

const getButtonActionIdentity = (
  element: EsTreeNodeOfType<"JSXElement">,
  name: string,
  context: RuleContext,
): SemanticIdentityResolution => {
  const openingElement = element.openingElement;
  const disabledResolution = getStaticBooleanAttributeResolution(openingElement, "disabled");
  if (disabledResolution.status === "unknown") return { status: "unknown", value: "" };
  if (disabledResolution.status === "known" && disabledResolution.value) {
    return { status: "known", value: `button|disabled|${name}` };
  }
  const typeResolution = getStaticAttributeResolution(openingElement, "type");
  if (typeResolution.status === "unknown") return { status: "unknown", value: "" };
  const buttonType =
    typeResolution.status === "known" ? typeResolution.value.toLowerCase() : "submit";
  const formResolution = getStaticAttributeResolution(openingElement, "form");
  const formActionResolution = getStaticAttributeResolution(openingElement, "formAction");
  if (
    (buttonType === "submit" || buttonType === "reset") &&
    (formResolution.status === "unknown" || formActionResolution.status === "unknown")
  ) {
    return { status: "unknown", value: "" };
  }
  const formBehavior =
    buttonType === "submit" || buttonType === "reset"
      ? `form:${formResolution.value}:${formActionResolution.value}`
      : "no-form-action";
  const onClickAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "onClick",
    false,
  );
  if (onClickAttribute) {
    if (
      !onClickAttribute.value ||
      !isNodeOfType(onClickAttribute.value, "JSXExpressionContainer")
    ) {
      return { status: "unknown", value: "" };
    }
    const onClickExpression = stripParenExpression(onClickAttribute.value.expression);
    if (!isNodeOfType(onClickExpression, "Identifier")) {
      return { status: "unknown", value: "" };
    }
    const onClickSymbol = context.scopes.symbolFor(onClickExpression);
    return onClickSymbol
      ? {
          status: "known",
          value: `button|${buttonType}|${formBehavior}|click:${onClickSymbol.id}|${name}`,
        }
      : { status: "unknown", value: "" };
  }
  if (buttonType !== "submit" && buttonType !== "reset") {
    return { status: "known", value: `button|${buttonType}|no-action|${name}` };
  }
  return {
    status: "known",
    value: `button|${buttonType}|${formBehavior}|${name}`,
  };
};

const getInteractiveIdentity = (
  element: EsTreeNodeOfType<"JSXElement">,
  tagName: string,
  childSummary: SemanticSummary,
  context: RuleContext,
): SemanticIdentityResolution => {
  if (!isInteractiveElement(tagName, element.openingElement)) {
    return { status: "absent", value: "" };
  }
  const nameResolution = getInteractiveName(element, childSummary);
  if (nameResolution.status !== "known") return nameResolution;
  if (tagName === "a" || tagName === "area") {
    const hrefResolution = getStaticAttributeResolution(element.openingElement, "href");
    if (hrefResolution.status === "unknown") return { status: "unknown", value: "" };
    return hrefResolution.status === "known" && hrefResolution.value
      ? { status: "known", value: `${tagName}|${hrefResolution.value}|${nameResolution.value}` }
      : { status: "absent", value: "" };
  }
  if (tagName === "button") {
    return getButtonActionIdentity(element, nameResolution.value, context);
  }
  return { status: "unknown", value: "" };
};

const summarizeSemanticChildren = (
  children: ReadonlyArray<EsTreeNode>,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): SemanticSummary => {
  const summary = createSemanticSummary();
  for (const child of children) {
    const staticTextResolution = getStaticTextFromJsxChild(child);
    if (staticTextResolution.status === "known") {
      if (staticTextResolution.value) summary.staticTextParts.push(staticTextResolution.value);
      continue;
    }
    if (staticTextResolution.status === "unknown") {
      summary.hasUnknownSemantics = true;
      continue;
    }
    if (isNodeOfType(child, "JSXElement")) {
      mergeSemanticSummary(
        summary,
        summarizeSemanticElement(child, targetVariantScope, context, false),
      );
      continue;
    }
    if (isNodeOfType(child, "JSXFragment")) {
      mergeSemanticSummary(
        summary,
        summarizeSemanticChildren(child.children, targetVariantScope, context),
      );
      continue;
    }
    summary.hasUnknownSemantics = true;
  }
  return summary;
};

const summarizeSemanticElement = (
  element: EsTreeNodeOfType<"JSXElement">,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
  skipRootTailwindVisibility: boolean,
): SemanticSummary => {
  const summary = createSemanticSummary();
  const openingElement = element.openingElement;
  const tagName = getProvenIntrinsicTagName(openingElement);
  if (!tagName) {
    summary.hasUnknownSemantics = true;
    return summary;
  }
  if (hasJsxSpreadAttribute(openingElement.attributes)) {
    summary.hasUnknownSemantics = true;
    return summary;
  }
  const rootVisibility = skipRootTailwindVisibility
    ? getElementNonTailwindVisibility(openingElement, context)
    : getElementVisibilityInScope(openingElement, targetVariantScope, context);
  if (rootVisibility === "unknown") summary.hasUnknownSemantics = true;
  if (rootVisibility !== "visible") return summary;
  if (tagName === "svg" || tagName === "canvas" || tagName === "template") return summary;
  const childSummary = summarizeSemanticChildren(element.children, targetVariantScope, context);
  mergeSemanticSummary(summary, childSummary);

  const roleResolution = getStaticAttributeResolution(openingElement, "role");
  if (roleResolution.status === "unknown") summary.hasUnknownSemantics = true;
  const role = roleResolution.status === "known" ? roleResolution.value.toLowerCase() : "";
  const isPresentational = PRESENTATIONAL_ROLES.has(role);
  if (!isPresentational) {
    if (tagName === "output" || LIVE_REGION_ROLES.has(role)) {
      summary.liveRegionIdentities.push(tagName === "output" ? "output" : `role:${role}`);
    }
    const ariaLiveResolution = getStaticAttributeResolution(openingElement, "aria-live");
    if (ariaLiveResolution.status === "unknown") summary.hasUnknownSemantics = true;
    if (
      ariaLiveResolution.status === "known" &&
      (ariaLiveResolution.value.toLowerCase() === "assertive" ||
        ariaLiveResolution.value.toLowerCase() === "polite")
    ) {
      summary.liveRegionIdentities.push(`aria-live:${ariaLiveResolution.value.toLowerCase()}`);
    }
    const interactiveIdentity = getInteractiveIdentity(element, tagName, childSummary, context);
    if (interactiveIdentity.status === "known") {
      summary.actionIdentities.push(interactiveIdentity.value);
    } else if (interactiveIdentity.status === "unknown") {
      summary.hasUnknownSemantics = true;
    }
  }
  return summary;
};

const summarizeSemanticExpression = (
  expression: EsTreeNode,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): SemanticSummary => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "JSXElement")) {
    return summarizeSemanticElement(unwrappedExpression, targetVariantScope, context, false);
  }
  if (isNodeOfType(unwrappedExpression, "JSXFragment")) {
    return summarizeSemanticChildren(unwrappedExpression.children, targetVariantScope, context);
  }
  const summary = createSemanticSummary();
  summary.hasUnknownSemantics = true;
  return summary;
};

const hasMeaningfulSemantics = (summary: SemanticSummary): boolean =>
  summary.actionIdentities.length > 0 ||
  summary.liveRegionIdentities.length > 0 ||
  STATIC_TEXT_PATTERN.test(normalizeStaticText(summary.staticTextParts));

const compareSemanticSummaries = (
  leftSummary: SemanticSummary,
  rightSummary: SemanticSummary,
): boolean | null => {
  if (leftSummary.hasUnknownSemantics || rightSummary.hasUnknownSemantics) return null;
  const leftActions = leftSummary.actionIdentities.toSorted();
  const rightActions = rightSummary.actionIdentities.toSorted();
  const leftLiveRegions = leftSummary.liveRegionIdentities.toSorted();
  const rightLiveRegions = rightSummary.liveRegionIdentities.toSorted();
  if (leftActions.some((identity, index) => identity !== rightActions[index])) return false;
  if (rightActions.length !== leftActions.length) return false;
  if (leftLiveRegions.some((identity, index) => identity !== rightLiveRegions[index])) return false;
  if (rightLiveRegions.length !== leftLiveRegions.length) return false;
  return (
    normalizeStaticText(leftSummary.staticTextParts) ===
    normalizeStaticText(rightSummary.staticTextParts)
  );
};

const getDirectSiblingFallbackStatus = (
  renderedChild: EsTreeNode,
  hiddenSummary: SemanticSummary,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): "absent" | "equivalent" | "unknown" => {
  const parent = renderedChild.parent;
  if (!parent || (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment"))) {
    return "absent";
  }
  let hasUnknownSibling = false;
  for (const sibling of parent.children) {
    if (sibling === renderedChild) continue;
    if (isNodeOfType(sibling, "JSXText")) {
      if (!STATIC_TEXT_PATTERN.test(sibling.value)) continue;
      const siblingSummary = createSemanticSummary();
      siblingSummary.staticTextParts.push(sibling.value);
      const comparison = compareSemanticSummaries(hiddenSummary, siblingSummary);
      if (comparison === true) return "equivalent";
      if (comparison === null) hasUnknownSibling = true;
      continue;
    }
    if (isNodeOfType(sibling, "JSXExpressionContainer")) {
      const textResolution = getStaticTextFromJsxChild(sibling);
      if (textResolution.status === "unknown") {
        hasUnknownSibling = true;
        continue;
      }
      if (textResolution.status === "known" && STATIC_TEXT_PATTERN.test(textResolution.value)) {
        const siblingSummary = createSemanticSummary();
        siblingSummary.staticTextParts.push(textResolution.value);
        const comparison = compareSemanticSummaries(hiddenSummary, siblingSummary);
        if (comparison === true) return "equivalent";
        if (comparison === null) hasUnknownSibling = true;
      }
      continue;
    }
    if (isNodeOfType(sibling, "JSXElement")) {
      const visibility = getElementVisibilityInScope(
        sibling.openingElement,
        targetVariantScope,
        context,
      );
      if (visibility === "hidden") continue;
      if (visibility === "unknown") {
        hasUnknownSibling = true;
        continue;
      }
      const siblingSummary = summarizeSemanticElement(sibling, targetVariantScope, context, true);
      const comparison = compareSemanticSummaries(hiddenSummary, siblingSummary);
      if (comparison === true) return "equivalent";
      if (comparison === null) hasUnknownSibling = true;
      continue;
    }
    if (isNodeOfType(sibling, "JSXFragment")) {
      const siblingSummary = summarizeSemanticChildren(
        sibling.children,
        targetVariantScope,
        context,
      );
      const comparison = compareSemanticSummaries(hiddenSummary, siblingSummary);
      if (comparison === true) return "equivalent";
      if (comparison === null) hasUnknownSibling = true;
      continue;
    }
    if (!isNodeOfType(sibling, "JSXClosingElement")) hasUnknownSibling = true;
  }
  return hasUnknownSibling ? "unknown" : "absent";
};

const isTransparentFallbackWrapper = (
  element: EsTreeNodeOfType<"JSXElement">,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): boolean => {
  const tagName = getProvenIntrinsicTagName(element.openingElement);
  if (!tagName || !NEUTRAL_FALLBACK_WRAPPER_TAGS.has(tagName)) return false;
  if (hasJsxSpreadAttribute(element.openingElement.attributes)) return false;
  if (
    getStaticAttributeResolution(element.openingElement, "role").status !== "absent" ||
    getStaticAttributeResolution(element.openingElement, "aria-live").status !== "absent" ||
    getStaticAttributeResolution(element.openingElement, "aria-label").status !== "absent" ||
    getStaticAttributeResolution(element.openingElement, "aria-labelledby").status !== "absent"
  ) {
    return false;
  }
  return (
    getElementVisibilityInScope(element.openingElement, targetVariantScope, context) === "visible"
  );
};

const getSiblingFallbackStatus = (
  renderedChild: EsTreeNode,
  hiddenSummary: SemanticSummary,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): "absent" | "equivalent" | "unknown" => {
  const directStatus = getDirectSiblingFallbackStatus(
    renderedChild,
    hiddenSummary,
    targetVariantScope,
    context,
  );
  if (directStatus !== "absent") return directStatus;
  const wrapper = renderedChild.parent;
  if (
    !wrapper ||
    !isNodeOfType(wrapper, "JSXElement") ||
    !isTransparentFallbackWrapper(wrapper, targetVariantScope, context)
  ) {
    return "absent";
  }
  const wrapperParent = wrapper.parent;
  if (
    !wrapperParent ||
    (!isNodeOfType(wrapperParent, "JSXElement") && !isNodeOfType(wrapperParent, "JSXFragment"))
  ) {
    return "absent";
  }
  const wrapperPair = wrapperParent.children.filter((child) => isNodeOfType(child, "JSXElement"));
  if (wrapperPair.length !== 2) return "absent";
  let hasUnknownSibling = false;
  const normalVariantScope = getNormalMotionScope(targetVariantScope);
  for (const sibling of wrapperPair) {
    if (sibling === wrapper) continue;
    const reducedVisibility = getElementVisibilityInScope(
      sibling.openingElement,
      targetVariantScope,
      context,
    );
    const normalVisibility = getElementVisibilityInScope(
      sibling.openingElement,
      normalVariantScope,
      context,
    );
    if (reducedVisibility === "unknown" || normalVisibility === "unknown") {
      hasUnknownSibling = true;
      continue;
    }
    if (reducedVisibility !== "visible") continue;
    const normalSummary =
      normalVisibility === "hidden"
        ? createSemanticSummary()
        : summarizeSemanticElement(sibling, normalVariantScope, context, true);
    if (normalSummary.hasUnknownSemantics) {
      hasUnknownSibling = true;
      continue;
    }
    if (hasMeaningfulSemantics(normalSummary)) continue;
    const siblingSummary = summarizeSemanticElement(sibling, targetVariantScope, context, true);
    const comparison = compareSemanticSummaries(hiddenSummary, siblingSummary);
    if (comparison === true) return "equivalent";
    if (comparison === null) hasUnknownSibling = true;
  }
  return hasUnknownSibling ? "unknown" : "absent";
};

const getReducedMotionCondition = (
  rawExpression: EsTreeNode,
  context: RuleContext,
): boolean | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const condition = getReducedMotionCondition(expression.argument, context);
    return condition === null ? null : !condition;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    return getMotionReactApiPath(expression.callee, context.scopes) === "useReducedMotion"
      ? true
      : null;
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(expression);
  if (!symbol || symbol.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    getMotionReactApiPath(initializer.callee, context.scopes) !== "useReducedMotion"
  ) {
    return null;
  }
  return true;
};

const isNullExpression = (expression: EsTreeNode): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  return isNodeOfType(unwrappedExpression, "Literal") && unwrappedExpression.value === null;
};

const getStaticExpressionTruthiness = (expression: EsTreeNode): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) {
    if (
      unwrappedExpression.value === null ||
      typeof unwrappedExpression.value === "boolean" ||
      typeof unwrappedExpression.value === "number" ||
      typeof unwrappedExpression.value === "string" ||
      typeof unwrappedExpression.value === "bigint"
    ) {
      return Boolean(unwrappedExpression.value);
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "TemplateLiteral")) {
    const value = getStaticTemplateLiteralValue(unwrappedExpression);
    return value === null ? null : Boolean(value);
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const truthiness = getStaticExpressionTruthiness(unwrappedExpression.argument);
    return truthiness === null ? null : !truthiness;
  }
  return null;
};

const canLogicalRightExpressionRun = (
  expression: EsTreeNodeOfType<"LogicalExpression">,
): boolean => {
  const leftTruthiness = getStaticExpressionTruthiness(expression.left);
  if (expression.operator === "&&") return leftTruthiness !== false;
  if (expression.operator === "||") return leftTruthiness !== true;
  const left = stripParenExpression(expression.left);
  return !isNodeOfType(left, "Literal") || left.value === null || left.value === undefined;
};

const directlyReachesRenderedOutput = (node: EsTreeNode): boolean => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) {
      const enclosingFunction = findEnclosingFunction(parent);
      return Boolean(enclosingFunction && isComponentFunction(enclosingFunction));
    }
    if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === current) {
      return isComponentFunction(parent);
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent !== current && parent.alternate !== current) return false;
      const testTruthiness = getStaticExpressionTruthiness(parent.test);
      if (
        testTruthiness !== null &&
        current !== (testTruthiness ? parent.consequent : parent.alternate)
      ) {
        return false;
      }
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      if (!canLogicalRightExpressionRun(parent)) return false;
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) ||
      ((isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
        (isNodeOfType(current, "JSXElement") ||
          isNodeOfType(current, "JSXFragment") ||
          isNodeOfType(current, "JSXExpressionContainer")))
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const getRenderedSiblingAnchor = (node: EsTreeNode): EsTreeNode | null => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) {
      return parent;
    }
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === current)
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return null;
  }
  return null;
};

const areRenderedJsxAncestorsVisible = (
  node: EsTreeNode,
  targetVariantScope: ReadonlyArray<string>,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "ReturnStatement") ||
      isNodeOfType(ancestor, "ArrowFunctionExpression")
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      getElementVisibilityInScope(ancestor.openingElement, targetVariantScope, context) !==
        "visible"
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return true;
};

export const noReducedMotionContentRemoval = defineRule({
  id: "no-reduced-motion-content-removal",
  title: "Reduced motion removes meaningful content",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  tags: ["react-jsx-only"],
  recommendation:
    "Keep the same content and actions available under reduced motion, replacing spatial movement with a static or non-spatial presentation.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!hasCapabilityOrUnspecified(context.settings, "tailwind")) return;
      if (!getProvenIntrinsicTagName(node)) return;
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const className = getStringFromClassNameAttr(node);
      if (className === null) return;
      const element = node.parent;
      if (!element || !isNodeOfType(element, "JSXElement")) return;
      if (!directlyReachesRenderedOutput(element)) return;
      const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
      for (const reducedMotionScope of getEffectiveReducedMotionScopes(className)) {
        if (!isRootAndAncestorsVisibleBeforeRemoval(element, reducedMotionScope, context)) continue;
        const displayVisibility = getEffectiveTailwindVisibility(
          parsedTokens,
          reducedMotionScope,
          "display",
        );
        const visibilityVisibility = getEffectiveTailwindVisibility(
          parsedTokens,
          reducedMotionScope,
          "visibility",
        );
        if (
          displayVisibility !== false &&
          visibilityVisibility === false &&
          getDescendantVisibilityEscape(element.children, reducedMotionScope, context) !== "absent"
        ) {
          continue;
        }
        const summary = summarizeSemanticElement(
          element,
          getNormalMotionScope(reducedMotionScope),
          context,
          true,
        );
        if (!hasMeaningfulSemantics(summary)) continue;
        if (getSiblingFallbackStatus(element, summary, reducedMotionScope, context) !== "absent") {
          continue;
        }
        context.report({
          node,
          message:
            "This reduced-motion utility hides meaningful content or an action. Keep equivalent content available and remove only the spatial motion.",
        });
        return;
      }
    },
    ConditionalExpression(node: EsTreeNodeOfType<"ConditionalExpression">) {
      if (!directlyReachesRenderedOutput(node)) return;
      if (
        !areRenderedJsxAncestorsVisible(node, ["motion-safe"], context) ||
        !areRenderedJsxAncestorsVisible(node, ["motion-reduce"], context)
      ) {
        return;
      }
      const condition = getReducedMotionCondition(node.test, context);
      if (condition === null) return;
      const reducedBranch = condition ? node.consequent : node.alternate;
      const motionBranch = condition ? node.alternate : node.consequent;
      if (!isNullExpression(reducedBranch)) return;
      const summary = summarizeSemanticExpression(motionBranch, ["motion-safe"], context);
      if (!hasMeaningfulSemantics(summary)) return;
      const siblingAnchor = getRenderedSiblingAnchor(node);
      if (
        siblingAnchor &&
        getSiblingFallbackStatus(siblingAnchor, summary, ["motion-reduce"], context) !== "absent"
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This useReducedMotion branch removes meaningful content or an action. Render an equivalent static presentation instead of null.",
      });
    },
  }),
});
