import { defineRule } from "../../utils/define-rule.js";
import { getTailwindVariantUtilities } from "../../utils/get-tailwind-variant-utilities.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const FOCUS_INDICATOR_PATTERN = /^(?:ring(?:-[1-9]|$)|outline-(?!none|0))/;
const FOCUS_TRANSITION_UTILITIES = new Set([
  "transition-shadow",
  "transition-[box-shadow]",
  "transition-[outline]",
  "transition-[box-shadow,outline]",
  "transition-[outline,box-shadow]",
]);

export const noTransitionedFocusRing = defineRule({
  id: "no-transitioned-focus-ring",
  title: "Focus indicator animates into view",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Keep keyboard focus indicators instant. Restrict transitions to hover colors or transforms that do not delay the focus ring.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (
        !classNameValue ||
        !getTailwindVariantUtilities(classNameValue, "focus-visible").some((utility) =>
          FOCUS_INDICATOR_PATTERN.test(utility),
        )
      ) {
        return;
      }
      const transitionUtility = getUnvariantClassNameTokens(classNameValue).find((token) =>
        FOCUS_TRANSITION_UTILITIES.has(token),
      );
      if (!transitionUtility) return;
      context.report({
        node,
        message: `The ${transitionUtility} utility delays the focus indicator. Keyboard focus must appear immediately.`,
      });
    },
  }),
});
