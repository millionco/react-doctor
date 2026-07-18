import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TAILWIND_DIRECT_VALUE_FRAGMENT_PATTERN =
  /^(?:accent|animate|aspect|basis|bg|border(?:-[trblxy])?|bottom|caret|col-span|columns|content|decoration|delay|divide-[xy]|duration|ease|fill|flex|font|from|gap(?:-[xy])?|grid-(?:cols|rows)|grow|h|inset(?:-[xy])?|items|justify|leading|left|m[trblxy]?|max-[wh]|min-[wh]|object|opacity|order|outline|overflow|p[trblxy]?|place-(?:content|items|self)|placeholder|right|ring(?:-offset)?|rotate|rounded(?:-[trbl]{1,2})?|row-span|scale|self|shadow|shrink|size|skew-[xy]|space-[xy]|stroke|text|to|top|tracking|translate-[xy]|via|w|z)-(?:\[[^\s]*)?$/;
const TAILWIND_COLOR_FRAGMENT_PATTERN =
  /^(?:accent|bg|border(?:-[trblxy])?|caret|decoration|divide-[xy]|fill|from|outline|placeholder|ring|stroke|text|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:\d{2,3})?\/?$/;

const getUtilityFragmentBeforeInterpolation = (staticText: string): string => {
  const tokenFragment = staticText.match(/[^\s]*$/)?.[0] ?? "";
  const unvariantFragment = tokenFragment.slice(tokenFragment.lastIndexOf(":") + 1);
  return unvariantFragment.replace(/^[!-]/, "");
};

const hasDynamicTailwindClassFragment = (
  templateLiteral: EsTreeNodeOfType<"TemplateLiteral">,
): boolean =>
  templateLiteral.expressions.some((_, expressionIndex) => {
    const precedingStaticText = templateLiteral.quasis[expressionIndex]?.value.raw ?? "";
    const utilityFragment = getUtilityFragmentBeforeInterpolation(precedingStaticText);
    return (
      TAILWIND_DIRECT_VALUE_FRAGMENT_PATTERN.test(utilityFragment) ||
      TAILWIND_COLOR_FRAGMENT_PATTERN.test(utilityFragment)
    );
  });

export const noDynamicTailwindClassFragment = defineRule({
  id: "no-dynamic-tailwind-class-fragment",
  title: "Tailwind utility is assembled dynamically",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  recommendation:
    "Use complete, statically discoverable Tailwind utility strings for each state instead of interpolating part of a class token.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "className") return;
      if (
        isNodeOfType(node.parent, "JSXOpeningElement") &&
        hasJsxSpreadAttribute(node.parent.attributes)
      ) {
        return;
      }
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
      if (!isNodeOfType(node.value.expression, "TemplateLiteral")) return;
      if (!hasDynamicTailwindClassFragment(node.value.expression)) return;
      context.report({
        node: node.value.expression,
        message:
          "Tailwind cannot reliably discover this dynamically assembled utility. Write each complete class token as a static string.",
      });
    },
  }),
});
