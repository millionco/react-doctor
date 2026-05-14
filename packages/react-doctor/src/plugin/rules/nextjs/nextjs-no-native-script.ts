import { EXECUTABLE_SCRIPT_TYPES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoNativeScript = defineRule<Rule>({
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    '`import Script from "next/script"` — use `strategy="afterInteractive"` for analytics or `"lazyOnload"` for widgets',
  examples: [
    {
      before: '<script src="https://example.com/analytics.js" />',
      after:
        'import Script from \'next/script\';\n<Script src="https://example.com/analytics.js" strategy="afterInteractive" />',
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "script") return;

      const typeAttribute = findJsxAttribute(node.attributes ?? [], "type");
      const typeValue = isNodeOfType(typeAttribute?.value, "Literal")
        ? typeAttribute.value.value
        : null;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;

      context.report({
        node,
        message:
          "Use next/script <Script> instead of <script> — provides loading strategy optimization and deferred loading",
      });
    },
  }),
});
