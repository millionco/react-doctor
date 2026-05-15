import { defineRule } from "../../utils/define-rule.js";
import { hasJsxAttribute } from "../../utils/has-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsImageMissingSizes = defineRule<Rule>({
  id: "nextjs-image-missing-sizes",
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    'Add sizes for responsive behavior: `sizes="(max-width: 768px) 100vw, 50vw"` matching your layout breakpoints',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "Image") return;
      const attributes = node.attributes ?? [];
      if (!hasJsxAttribute(attributes, "fill")) return;
      if (hasJsxAttribute(attributes, "sizes")) return;

      context.report({
        node,
        message:
          "next/image with fill but no sizes — the browser downloads the largest image. Add a sizes attribute for responsive behavior",
      });
    },
  }),
});
