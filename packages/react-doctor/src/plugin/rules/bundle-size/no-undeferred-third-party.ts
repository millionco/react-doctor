import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { hasJsxAttribute } from "../../utils/has-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noUndeferredThirdParty = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Bundle Size",
  recommendation: 'Use `next/script` with `strategy="lazyOnload"` or add the `defer` attribute',
  examples: [
    {
      before: '<script src="https://cdn.example.com/widget.js" />',
      after: '<script src="https://cdn.example.com/widget.js" defer />',
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "script") return;
      const attributes = node.attributes ?? [];
      if (!findJsxAttribute(attributes, "src")) return;

      if (!hasJsxAttribute(attributes, "defer") && !hasJsxAttribute(attributes, "async")) {
        context.report({
          node,
          message:
            "Synchronous <script> with src — add defer or async to avoid blocking first paint",
        });
      }
    },
  }),
});
