import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

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
const LAYOUT_UTILITY_PATTERN =
  /^(?:-)?(?:m[trblxy]?|p[trblxy]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-w|min-h|max-w|max-h|basis|grow|shrink|leading|tracking)-/;
const ARBITRARY_FONT_SIZE_PATTERN =
  /^text-\[(?:\d+(?:\.\d+)?|\.\d+)(?:cap|ch|cqb|cqh|cqi|cqmax|cqmin|cqw|em|ex|ic|lh|px|rem|rlh|vb|vh|vi|vmax|vmin|vw|%)\](?:\/.+)?$/;

const getLayoutShiftingInteractionToken = (className: string): string | null => {
  for (const token of className.split(/\s+/)) {
    const segments = token.split(":");
    if (segments.length < 2) continue;
    const utility = segments[segments.length - 1].replace(/^!|!$/g, "");
    if (!segments.slice(0, -1).some((variant) => INTERACTION_VARIANTS.has(variant))) continue;
    if (
      FONT_WEIGHT_UTILITIES.has(utility) ||
      ARBITRARY_FONT_SIZE_PATTERN.test(utility) ||
      /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/.test(utility) ||
      LAYOUT_UTILITY_PATTERN.test(utility)
    ) {
      return token;
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
