import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noJustifiedText = defineRule<Rule>({
  id: "no-justified-text",
  title: "Justified text without hyphens",
  tags: ["test-noise"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use `text-align: left` for body text. If you must justify, add `hyphens: auto` and `overflow-wrap: break-word`.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let isJustified = false;
      let hasHyphens = false;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        const value = getStylePropertyStringValue(property);
        if (!key || !value) continue;

        if (key === "textAlign" && value === "justify") isJustified = true;
        if ((key === "hyphens" || key === "WebkitHyphens") && value === "auto") hasHyphens = true;
      }

      if (isJustified && !hasHyphens) {
        context.report({
          node,
          message:
            "Your users read big uneven gaps between words because justified text has no hyphens, so use text-align: left, or add hyphens: auto.",
        });
      }
    },
  }),
});
