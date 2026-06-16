import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `text-[13px]` / `text-[13.5px]`, optionally with a `/line-height` suffix
// (`text-[13px]/5`). Only `text-[...]` — `px` stays correct for `border-*` /
// `outline-*`, which use pixels natively.
const ARBITRARY_PX_FONT_SIZE = /(?:^|\s)(?:\w+:)*text-\[(\d+(?:\.\d+)?)px\]/g;

export const noArbitraryPxFontSize = defineRule({
  id: "no-arbitrary-px-font-size",
  title: "Pixel arbitrary font size",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use `rem` for arbitrary font sizes (`text-[0.8125rem]`, not `text-[13px]`) so text scales with the user's root font-size preference. Pixels stay fine for `border-*` / `outline-*`.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      for (const match of classNameValue.matchAll(ARBITRARY_PX_FONT_SIZE)) {
        const pixels = parseFloat(match[1]);
        const rem = pixels / 16;
        context.report({
          node,
          message: `\`text-[${match[1]}px]\` doesn't scale with the user's font-size preference — use rem, e.g. \`text-[${rem}rem]\`.`,
        });
      }
    },
  }),
});
