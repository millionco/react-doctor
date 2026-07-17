import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

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
