import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";

const getRevealKind = (utility: string): string | null => {
  if (utility === "visible") return "visibility";
  if (
    ["block", "flex", "grid", "inline", "inline-block", "inline-flex", "inline-grid"].includes(
      utility,
    )
  ) {
    return "display";
  }
  if (/^opacity-(?!0(?:$|\D))/.test(utility)) return "opacity";
  return null;
};

const hasBaseHiddenState = (tokens: ReadonlyArray<string>, revealKind: string): boolean => {
  if (revealKind === "visibility") return tokens.includes("invisible");
  if (revealKind === "display") return tokens.includes("hidden");
  return tokens.includes("opacity-0");
};

const hasKeyboardReveal = (
  tokens: ReadonlyArray<string>,
  hoverVariant: string,
  revealKind: string,
): boolean => {
  const acceptedVariants =
    hoverVariant === "group-hover"
      ? new Set(["group-focus", "group-focus-within"])
      : new Set(["focus", "focus-visible"]);
  return tokens.some((token) => {
    const segments = token.split(":");
    const utility = segments.at(-1) ?? "";
    return (
      segments.slice(0, -1).some((segment) => acceptedVariants.has(segment)) &&
      getRevealKind(utility) === revealKind
    );
  });
};

const getHoverOnlyReveal = (className: string): string | null => {
  const tokens = className.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const segments = token.split(":");
    const hoverVariant = segments
      .slice(0, -1)
      .find((segment) => segment === "hover" || segment === "group-hover");
    if (!hoverVariant) continue;
    const revealKind = getRevealKind(segments.at(-1) ?? "");
    if (
      revealKind &&
      hasBaseHiddenState(tokens, revealKind) &&
      !hasKeyboardReveal(tokens, hoverVariant, revealKind)
    ) {
      return token;
    }
  }
  return null;
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
  const animateOpacity = getStaticOpacity(
    getStaticMotionPropObject(node, "animate", context.scopes),
  );
  const hoverOpacity = getStaticOpacity(
    getStaticMotionPropObject(node, "whileHover", context.scopes),
  );
  const focusOpacity = getStaticOpacity(
    getStaticMotionPropObject(node, "whileFocus", context.scopes),
  );
  return (
    (initialOpacity === 0 || animateOpacity === 0) &&
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
      if (hasMotionHoverOnlyReveal(node, context)) {
        context.report({
          node,
          message:
            "This Motion element reveals hidden content only on pointer hover. Add an equivalent whileFocus state and keep the action reachable on touch devices.",
        });
        return;
      }
      const className = getStringFromClassNameAttr(node);
      if (!className) return;
      const revealToken = getHoverOnlyReveal(className);
      if (!revealToken) return;
      context.report({
        node,
        message: `The "${revealToken}" utility reveals hidden content only to pointer hover. Add a matching keyboard-focus reveal and a touch-accessible path.`,
      });
    },
  }),
});
