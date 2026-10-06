import { defineRule } from "../../utils/define-rule.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { hasKeyboardActivatableDescendant } from "../../utils/has-keyboard-activatable-descendant.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { resolveTailwindBooleanPropertyState } from "../../utils/resolve-tailwind-boolean-property-state.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getStaticTailwindOpacity } from "./utils/get-static-tailwind-opacity.js";

const DIRECT_HOVER_VARIANT = "hover";
const GROUP_HOVER_VARIANT = "group-hover";
const DIRECT_KEYBOARD_REVEAL_VARIANTS = new Set(["focus", "focus-visible"]);
const GROUP_KEYBOARD_REVEAL_VARIANTS = new Set(["group-focus", "group-focus-within"]);

const getRevealKind = (utility: string): string | null => {
  if (utility === "visible") return "visibility";
  if (
    ["block", "flex", "grid", "inline", "inline-block", "inline-flex", "inline-grid"].includes(
      utility,
    )
  ) {
    return "display";
  }
  const opacity = getStaticTailwindOpacity(utility);
  if (opacity !== null && opacity > 0) return "opacity";
  return null;
};

const getVariantName = (variant: string): string => variant.split("/")[0] ?? variant;

const getVariantModifier = (variant: string): string | null => {
  const separatorIndex = variant.indexOf("/");
  return separatorIndex < 0 ? null : variant.slice(separatorIndex + 1);
};

const getVariantScopeWithout = (
  variants: ReadonlyArray<string>,
  removedVariantIndex: number,
): string[] => variants.filter((_, variantIndex) => variantIndex !== removedVariantIndex);

const getHiddenStateForUtility = (utility: string, revealKind: string): boolean | null => {
  if (revealKind === "visibility") {
    if (utility === "invisible") return true;
    if (utility === "visible") return false;
    return null;
  }
  if (revealKind === "display") {
    if (utility === "hidden") return true;
    if (getRevealKind(utility) === "display") return false;
    return null;
  }
  const opacity = getStaticTailwindOpacity(utility);
  if (opacity === 0) return true;
  if (opacity !== null && opacity > 0) return false;
  return null;
};

const getEffectiveHiddenState = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  revealKind: string,
): boolean | null =>
  resolveTailwindBooleanPropertyState(parsedTokens, targetVariantScope, (utility) =>
    getHiddenStateForUtility(utility, revealKind),
  );

const isEquivalentKeyboardVariant = (keyboardVariant: string, hoverVariant: string): boolean => {
  const hoverVariantName = getVariantName(hoverVariant);
  const keyboardVariantName = getVariantName(keyboardVariant);
  if (hoverVariantName === DIRECT_HOVER_VARIANT) {
    return (
      DIRECT_KEYBOARD_REVEAL_VARIANTS.has(keyboardVariantName) &&
      getVariantModifier(keyboardVariant) === getVariantModifier(hoverVariant)
    );
  }
  return (
    GROUP_KEYBOARD_REVEAL_VARIANTS.has(keyboardVariantName) &&
    getVariantModifier(keyboardVariant) === getVariantModifier(hoverVariant)
  );
};

const hasKeyboardReveal = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  hoverVariants: ReadonlyArray<string>,
  hoverVariantIndex: number,
  revealKind: string,
  canReceiveKeyboardFocus: boolean,
): boolean | null => {
  const hoverVariant = hoverVariants[hoverVariantIndex];
  if (!hoverVariant) return false;
  let hasUnknownKeyboardState = false;
  const hasProvenKeyboardReveal = parsedTokens.some((parsedToken) => {
    const keyboardVariantIndex = parsedToken.variants.findIndex((variant) =>
      isEquivalentKeyboardVariant(variant, hoverVariant),
    );
    if (keyboardVariantIndex < 0 || getRevealKind(parsedToken.utility) !== revealKind) return false;
    if (
      getVariantName(hoverVariant) === DIRECT_HOVER_VARIANT &&
      (!canReceiveKeyboardFocus || revealKind === "display" || revealKind === "visibility")
    ) {
      return false;
    }
    const keyboardVariant = parsedToken.variants[keyboardVariantIndex];
    if (!keyboardVariant) return false;
    const keyboardScopeMappedToHover = parsedToken.variants.map((variant, variantIndex) =>
      variantIndex === keyboardVariantIndex ? hoverVariant : variant,
    );
    if (!doesTailwindVariantScopeCover(keyboardScopeMappedToHover, hoverVariants)) {
      return false;
    }
    const keyboardTargetScope = hoverVariants.map((variant, variantIndex) =>
      variantIndex === hoverVariantIndex ? keyboardVariant : variant,
    );
    const hiddenState = getEffectiveHiddenState(parsedTokens, keyboardTargetScope, revealKind);
    if (hiddenState === null) hasUnknownKeyboardState = true;
    return hiddenState === false;
  });
  if (hasProvenKeyboardReveal) return true;
  return hasUnknownKeyboardState ? null : false;
};

const canElementReceiveKeyboardFocus = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const elementName = resolveJsxElementName(node);
  if (!elementName) return false;
  if (/^[a-z]/.test(elementName)) return isFocusableJsxOpeningElement(node, elementName);
  return true;
};

const getHoverOnlyReveal = (
  className: string,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  const tokens = splitTailwindClassName(className);
  const parsedTokens = tokens.map(parseTailwindClassNameToken);
  const canReceiveKeyboardFocus = canElementReceiveKeyboardFocus(node);
  for (const [tokenIndex, parsedToken] of parsedTokens.entries()) {
    const hoverVariantIndex = parsedToken.variants.findIndex((variant) => {
      const variantName = getVariantName(variant);
      return variantName === DIRECT_HOVER_VARIANT || variantName === GROUP_HOVER_VARIANT;
    });
    if (hoverVariantIndex < 0) continue;
    const revealKind = getRevealKind(parsedToken.utility);
    const hoverVariantScope = getVariantScopeWithout(parsedToken.variants, hoverVariantIndex);
    const keyboardReveal = revealKind
      ? hasKeyboardReveal(
          parsedTokens,
          parsedToken.variants,
          hoverVariantIndex,
          revealKind,
          canReceiveKeyboardFocus,
        )
      : false;
    if (
      revealKind &&
      getEffectiveHiddenState(parsedTokens, hoverVariantScope, revealKind) === true &&
      getEffectiveHiddenState(parsedTokens, parsedToken.variants, revealKind) === false &&
      keyboardReveal === false
    ) {
      return tokens[tokenIndex] ?? null;
    }
  }
  return null;
};

const childCanRenderContent = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXText")) return child.value.trim().length > 0;
  if (isNodeOfType(child, "JSXExpressionContainer")) {
    if (isNodeOfType(child.expression, "JSXEmptyExpression")) return false;
    if (isNodeOfType(child.expression, "Literal")) {
      if (child.expression.value === null || typeof child.expression.value === "boolean") {
        return false;
      }
      return String(child.expression.value).trim().length > 0;
    }
    return true;
  }
  if (isNodeOfType(child, "JSXFragment")) return child.children.some(childCanRenderContent);
  return isNodeOfType(child, "JSXElement");
};

const canRevealContentOrAction = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const element = node.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return true;
  if (element.children.some(childCanRenderContent)) return true;
  const elementName = resolveJsxElementName(node)?.toLowerCase();
  if (elementName && isInteractiveElement(elementName, node)) return true;
  return hasKeyboardActivatableDescendant(element, null, context.scopes, context.settings);
};

const getStaticOpacity = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression"> | null,
): number | null => {
  if (!objectExpression) return null;
  const property = getEffectiveStyleProperty(objectExpression.properties, "opacity");
  return property &&
    isNodeOfType(property.value, "Literal") &&
    typeof property.value.value === "number"
    ? property.value.value
    : null;
};

const hasMotionHoverOnlyReveal = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const initialOpacity = getStaticOpacity(
    getStaticMotionPropObject(node, "initial", context.scopes),
  );
  const animateObject = getStaticMotionPropObject(node, "animate", context.scopes);
  const animateOpacity = getStaticOpacity(animateObject);
  if (getAuthoritativeJsxAttribute(node.attributes, "animate") && !animateObject) return false;
  const hoverOpacity = getStaticOpacity(
    getStaticMotionPropObject(node, "whileHover", context.scopes),
  );
  const focusOpacity = getStaticOpacity(
    getStaticMotionPropObject(node, "whileFocus", context.scopes),
  );
  const restingOpacity = animateObject ? animateOpacity : initialOpacity;
  return (
    restingOpacity === 0 &&
    hoverOpacity !== null &&
    hoverOpacity > 0 &&
    !(focusOpacity !== null && focusOpacity > 0)
  );
};

export const noHoverOnlyReveal = defineRule({
  id: "no-hover-only-reveal",
  title: "Content is revealed only on hover",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Mirror hover reveals with focus or focus-within, and keep essential controls available to touch users.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (hasJsxSpreadAttribute(node.attributes)) return;
      if (!canRevealContentOrAction(node, context)) return;
      if (hasMotionHoverOnlyReveal(node, context)) {
        context.report({
          node,
          message:
            "This Motion element reveals hidden content only on pointer hover. Add an equivalent whileFocus state and keep the action reachable on touch devices.",
        });
        return;
      }
      if (!hasCapabilityOrUnspecified(context.settings, "tailwind")) return;
      const className = getStringFromClassNameAttr(node);
      if (!className) return;
      const revealToken = getHoverOnlyReveal(className, node);
      if (!revealToken) return;
      context.report({
        node,
        message: `The "${revealToken}" utility reveals hidden content only to pointer hover. Add a matching keyboard-focus reveal and a touch-accessible path.`,
      });
    },
  }),
});
