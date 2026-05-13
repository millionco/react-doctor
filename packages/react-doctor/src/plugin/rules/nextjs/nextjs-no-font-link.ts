import { GOOGLE_FONTS_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const nextjsNoFontLink = defineRule<Rule>({
  recommendation:
    '`import { Inter } from "next/font/google"` — self-hosted, zero layout shift, no render-blocking requests',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      const hrefValue = hrefAttribute.value.type === "Literal" ? hrefAttribute.value.value : null;

      if (typeof hrefValue === "string" && GOOGLE_FONTS_PATTERN.test(hrefValue)) {
        context.report({
          node,
          message:
            "Loading Google Fonts via <link> — use next/font instead for self-hosting, zero layout shift, and no render-blocking requests",
        });
      }
    },
  }),
});
