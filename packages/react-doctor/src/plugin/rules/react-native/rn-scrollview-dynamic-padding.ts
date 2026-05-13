import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { SCROLLVIEW_NAMES } from "./utils/scrollview_names.js";

// HACK: dynamic `paddingBottom`/`paddingTop` on `contentContainerStyle`
// (e.g. `paddingBottom: keyboardHeight`) reflows the entire scroll
// content every time the value changes — the rows visually shift, and
// any sticky headers re-pin. The native equivalent is `contentInset`,
// which the platform applies as an OS-level offset without re-laying out
// the content.
export const rnScrollviewDynamicPadding = defineRule<Rule>({
  recommendation:
    "Use `contentInset={{ bottom: dynamicValue }}` — the OS applies it as an offset without reflowing the scroll content",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = resolveJsxElementName(node);
      if (!elementName) return;
      if (
        !SCROLLVIEW_NAMES.has(elementName) &&
        elementName !== "FlatList" &&
        elementName !== "FlashList"
      )
        return;

      for (const attr of node.attributes ?? []) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name?.type !== "JSXIdentifier" || attr.name.name !== "contentContainerStyle")
          continue;
        if (attr.value?.type !== "JSXExpressionContainer") continue;
        const expression = attr.value.expression;
        if (expression?.type !== "ObjectExpression") continue;

        for (const property of expression.properties ?? []) {
          if (property.type !== "Property") continue;
          if (property.key?.type !== "Identifier") continue;
          const key = property.key.name;
          if (key !== "paddingBottom" && key !== "paddingTop") continue;
          // Static numeric value is fine — only flag dynamic identifiers /
          // member expressions that change between renders.
          const value = property.value;
          if (!value) continue;
          if (value.type === "Literal") continue;

          context.report({
            node: property,
            message: `Dynamic ${key} on contentContainerStyle reflows the scroll content — use \`contentInset\` (OS-level offset, no relayout) instead`,
          });
          return;
        }
      }
    },
  }),
});
