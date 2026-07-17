import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const getFirstStaticContentElement = (
  element: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null | undefined => {
  for (const child of element.children) {
    if (isNodeOfType(child, "JSXText") && child.value.trim().length === 0) continue;
    if (isNodeOfType(child, "JSXElement")) return child.openingElement;
    if (
      isNodeOfType(child, "JSXExpressionContainer") &&
      isNodeOfType(child.expression, "JSXEmptyExpression")
    ) {
      continue;
    }
    return undefined;
  }
  return null;
};

export const detailsRequiresSummary = defineRule({
  id: "details-requires-summary",
  title: "Details disclosure has no explicit summary",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Make a meaningful summary the first child of details so users can understand and operate the disclosure.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (resolveJsxElementType(node.openingElement) !== "details") return;
      const firstContentElement = getFirstStaticContentElement(node);
      if (firstContentElement === undefined) return;
      if (firstContentElement && resolveJsxElementType(firstContentElement) === "summary") return;
      context.report({
        node: firstContentElement ?? node.openingElement,
        message:
          "This details disclosure has no explicit summary as its first content child, so the browser falls back to an implementation-defined label. Add a meaningful summary first.",
      });
    },
  }),
});
