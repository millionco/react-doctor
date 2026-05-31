import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noDisabledZoom = defineRule<Rule>({
  id: "no-disabled-zoom",
  title: "Zoom disabled on viewport",
  severity: "error",
  tags: ["test-noise"],
  category: "Accessibility",
  recommendation:
    "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag. If the layout breaks at 200% zoom, fix the layout instead.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
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
          message: `Your users can't pinch to zoom because user-scalable=no & maximum-scale=${maxScaleMatch[1]} block it, which fails accessibility (WCAG 1.4.4). Remove both & fix the layout if it breaks at 200%.`,
        });
      } else if (hasUserScalableNo) {
        context.report({
          node,
          message:
            "Your users can't pinch to zoom because user-scalable=no blocks it, which fails accessibility (WCAG 1.4.4). Remove it & fix the layout if it breaks at 200%.",
        });
      } else if (hasRestrictiveMaxScale) {
        context.report({
          node,
          message: `Your users can't zoom past 200% because maximum-scale=${maxScaleMatch[1]} blocks it, which fails accessibility (WCAG 1.4.4). Use maximum-scale=5 or remove it.`,
        });
      }
    },
  }),
});
