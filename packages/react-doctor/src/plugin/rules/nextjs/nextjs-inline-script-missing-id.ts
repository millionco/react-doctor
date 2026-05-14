import { defineRule } from "../../utils/define-rule.js";
import { hasJsxAttribute } from "../../utils/has-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const nextjsInlineScriptMissingId = defineRule<Rule>({
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    'Add `id="descriptive-name"` so Next.js can track, deduplicate, and re-execute the script correctly',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "Script") return;
      const attributes = node.attributes ?? [];

      if (hasJsxAttribute(attributes, "src")) return;
      if (hasJsxAttribute(attributes, "id")) return;

      context.report({
        node,
        message:
          "Inline <Script> without id — Next.js requires an id attribute to track inline scripts",
      });
    },
  }),
});
