import { ROOT_FONT_SIZE_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const ARBITRARY_PX_FONT_SIZE = /^text-\[(?:length:)?((?:\d+(?:\.\d*)?|\.\d+))px\](\/.+)?$/i;

export const noArbitraryPxFontSize = defineRule({
  id: "no-arbitrary-px-font-size",
  title: "Pixel arbitrary font size",
  tags: ["design", "test-noise"],
  defaultEnabled: false,
  requires: ["tailwind"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use `rem` for arbitrary font sizes (`text-[0.8125rem]`, not `text-[13px]`) so text scales with the user's root font-size preference. Pixels stay fine for `border-*` / `outline-*`.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      for (const token of getClassNameTokens(classNameValue)) {
        const match = token.match(ARBITRARY_PX_FONT_SIZE);
        if (!match) continue;
        const pixels = parseFloat(match[1]);
        if (pixels === 0) continue;
        const rem = pixels / ROOT_FONT_SIZE_PX;
        const lineHeightSuffix = match[2] ?? "";
        context.report({
          node,
          message: `\`${match[0]}\` doesn't scale with the user's font-size preference — use rem, e.g. \`text-[${rem}rem]${lineHeightSuffix}\`.`,
        });
      }
    },
  }),
});
