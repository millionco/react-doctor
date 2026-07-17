import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Tailwind v4 renamed/removed these utilities. Map each deprecated base token
// to its canonical v4 replacement. Gated on `tailwind:4` so v3 projects, where
// these are still the correct names, are never flagged.
const renameDeprecatedToken = (token: string): string | null => {
  if (token === "overflow-ellipsis") return "text-ellipsis";
  if (token === "flex-shrink" || token.startsWith("flex-shrink-"))
    return token.replace("flex-shrink", "shrink");
  if (token === "flex-grow" || token.startsWith("flex-grow-"))
    return token.replace("flex-grow", "grow");
  // Only the directional gradients were renamed to `bg-linear-to-*`; v4's
  // radial/conic are `bg-radial`/`bg-conic`, so don't touch `bg-gradient-radial`.
  if (/^bg-gradient-to-(?:t|tr|r|br|b|bl|l|tl)$/.test(token))
    return token.replace("bg-gradient-to-", "bg-linear-to-");
  return null;
};

export const noDeprecatedTailwindClass = defineRule({
  id: "no-deprecated-tailwind-class",
  title: "Deprecated Tailwind v4 utility",
  tags: ["design", "test-noise"],
  severity: "warn",
  requires: ["tailwind:4"],
  recommendation:
    "Tailwind v4 renamed these utilities: `bg-gradient-*` → `bg-linear-*`, `flex-shrink-*` → `shrink-*`, `flex-grow-*` → `grow-*`, `overflow-ellipsis` → `text-ellipsis`. Use the new names.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      for (const token of getClassNameTokens(classNameValue)) {
        const replacement = renameDeprecatedToken(token);
        if (replacement) {
          context.report({
            node,
            message: `\`${token}\` is a legacy Tailwind name — use the canonical v4 utility \`${replacement}\`.`,
          });
        }
      }
    },
  }),
});
