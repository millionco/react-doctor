import { GOOGLE_FONTS_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoFontLink = defineRule<Rule>({
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    '`import { Inter } from "next/font/google"` — self-hosted, zero layout shift, no render-blocking requests',
  examples: [
    {
      before: '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />',
      after:
        "import { Inter } from 'next/font/google';\nconst inter = Inter({ subsets: ['latin'] });\n<body className={inter.className}>…</body>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      const hrefValue = isNodeOfType(hrefAttribute.value, "Literal")
        ? hrefAttribute.value.value
        : null;

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
