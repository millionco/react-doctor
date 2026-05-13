import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const nextjsNoAElement = defineRule<Rule>({
  recommendation:
    "`import Link from 'next/link'` — enables client-side navigation, prefetching, and preserves scroll position",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "a") return;

      const hrefAttribute = findJsxAttribute(node.attributes ?? [], "href");
      if (!hrefAttribute?.value) return;

      let hrefValue = null;
      if (hrefAttribute.value.type === "Literal") {
        hrefValue = hrefAttribute.value.value;
      } else if (
        hrefAttribute.value.type === "JSXExpressionContainer" &&
        hrefAttribute.value.expression?.type === "Literal"
      ) {
        hrefValue = hrefAttribute.value.expression.value;
      }

      if (typeof hrefValue === "string" && hrefValue.startsWith("/")) {
        context.report({
          node,
          message:
            "Use next/link instead of <a> for internal links — enables client-side navigation and prefetching",
        });
      }
    },
  }),
});
