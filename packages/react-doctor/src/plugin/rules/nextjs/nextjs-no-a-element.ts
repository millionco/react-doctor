import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoAElement = defineRule<Rule>({
  id: "nextjs-no-a-element",
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "`import Link from 'next/link'` — enables client-side navigation, prefetching, and preserves scroll position",
  examples: [
    {
      before: '<a href="/about">About</a>',
      after: "import Link from 'next/link';\n<Link href=\"/about\">About</Link>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "a") return;

      const hrefAttribute = findJsxAttribute(node.attributes ?? [], "href");
      if (!hrefAttribute?.value) return;

      let hrefValue = null;
      if (isNodeOfType(hrefAttribute.value, "Literal")) {
        hrefValue = hrefAttribute.value.value;
      } else if (
        isNodeOfType(hrefAttribute.value, "JSXExpressionContainer") &&
        isNodeOfType(hrefAttribute.value.expression, "Literal")
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
