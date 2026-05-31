import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideExcludedTypographyAncestor } from "./utils/is-inside-excluded-typography-ancestor.js";

const EM_DASH = "—";

export const noEmDashInJsxText = defineRule<Rule>({
  id: "design-no-em-dash-in-jsx-text",
  title: "Em dash in JSX text",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Replace em dashes in UI text with commas, colons, semicolons, or parentheses so the copy reads less like AI output.",
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!textValue.includes(EM_DASH)) return;
      if (isInsideExcludedTypographyAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message: "Em dash (—) in UI text reads like AI output to your users.",
      });
    },
  }),
});
