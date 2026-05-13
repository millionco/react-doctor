import { POLYFILL_SCRIPT_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const nextjsNoPolyfillScript = defineRule<Rule>({
  recommendation:
    "Next.js includes polyfills for fetch, Promise, Object.assign, Array.from, and 50+ others automatically",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "script" && node.name.name !== "Script") return;

      const srcAttribute = findJsxAttribute(node.attributes ?? [], "src");
      if (!srcAttribute?.value) return;

      const srcValue = srcAttribute.value.type === "Literal" ? srcAttribute.value.value : null;

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
