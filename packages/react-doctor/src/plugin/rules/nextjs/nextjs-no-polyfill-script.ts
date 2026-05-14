import { POLYFILL_SCRIPT_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoPolyfillScript = defineRule<Rule>({
  id: "nextjs-no-polyfill-script",
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "Next.js includes polyfills for fetch, Promise, Object.assign, Array.from, and 50+ others automatically",
  examples: [
    {
      before: '<Script src="https://cdn.polyfill.io/v3/polyfill.min.js" />',
      after: "// remove the polyfill <Script /> — Next.js handles it automatically",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "script" && node.name.name !== "Script") return;

      const srcAttribute = findJsxAttribute(node.attributes ?? [], "src");
      if (!srcAttribute?.value) return;

      const srcValue = isNodeOfType(srcAttribute.value, "Literal")
        ? srcAttribute.value.value
        : null;

      if (typeof srcValue === "string" && POLYFILL_SCRIPT_PATTERN.test(srcValue)) {
        context.report({
          node,
          message:
            "Polyfill CDN script — Next.js includes polyfills for fetch, Promise, Object.assign, and 50+ others automatically",
        });
      }
    },
  }),
});
