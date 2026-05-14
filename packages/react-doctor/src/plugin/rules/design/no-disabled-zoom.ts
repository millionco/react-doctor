import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const noDisabledZoom = defineRule<Rule>({
  framework: "global",
  severity: "error",
  category: "Accessibility",
  recommendation:
    "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag. If your layout breaks at 200% zoom, fix the layout — don't punish users with disabilities",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "meta") return;

      const nameAttr = findJsxAttribute(node.attributes ?? [], "name");
      if (!nameAttr?.value) return;
      const nameValue = isNodeOfType(nameAttr.value, "Literal") ? nameAttr.value.value : null;
      if (nameValue !== "viewport") return;

      const contentAttr = findJsxAttribute(node.attributes ?? [], "content");
      if (!contentAttr?.value) return;
      const contentValue =
        isNodeOfType(contentAttr.value, "Literal") && typeof contentAttr.value.value === "string"
          ? contentAttr.value.value
          : null;
      if (!contentValue) return;

      const hasUserScalableNo = /user-scalable\s*=\s*no/i.test(contentValue);
      const maxScaleMatch = contentValue.match(/maximum-scale\s*=\s*([\d.]+)/i);
      const hasRestrictiveMaxScale = maxScaleMatch !== null && parseFloat(maxScaleMatch[1]) < 2;

      if (hasUserScalableNo && hasRestrictiveMaxScale) {
        context.report({
          node,
          message: `user-scalable=no and maximum-scale=${maxScaleMatch[1]} disable pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4). Remove both and fix layout if it breaks at 200% zoom`,
        });
      } else if (hasUserScalableNo) {
        context.report({
          node,
          message:
            "user-scalable=no disables pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4). Remove it and fix layout if it breaks at 200% zoom",
        });
      } else if (hasRestrictiveMaxScale) {
        context.report({
          node,
          message: `maximum-scale=${maxScaleMatch[1]} restricts zoom below 200% — this is an accessibility violation (WCAG 1.4.4). Use maximum-scale=5 or remove it`,
        });
      }
    },
  }),
});
