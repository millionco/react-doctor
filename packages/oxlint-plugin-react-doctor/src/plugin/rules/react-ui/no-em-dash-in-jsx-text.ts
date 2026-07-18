import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideExcludedTypographyAncestor } from "./utils/is-inside-excluded-typography-ancestor.js";

const EM_DASH = "—";
const LONG_FORM_CONTENT_PATH_PATTERN =
  /(?:^|[/\\])(?:articles?|blog|changelog|content|docs?|posts?)(?:[/\\]|$)/i;

// Only an em dash embedded in prose (letters on both sides, same line)
// reads as AI-generated copy. Standalone `—` placeholders for empty
// values, ` — ` separators between interpolations, and dash bullets are
// deliberate typography.
const PROSE_EM_DASH_PATTERN = /\p{L}[^—\n]*—[^—\n]*\p{L}/u;

export const noEmDashInJsxText = defineRule({
  id: "design-no-em-dash-in-jsx-text",
  title: "Em dash in JSX text",
  tags: ["design", "test-noise"],
  severity: "warn",
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  category: "Architecture",
  recommendation:
    "Replace em dashes in UI text with commas, colons, semicolons, or parentheses so the copy reads less like AI output.",
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      if (context.filename && LONG_FORM_CONTENT_PATH_PATTERN.test(context.filename)) return;
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!textValue.includes(EM_DASH)) return;
      if (!PROSE_EM_DASH_PATTERN.test(textValue)) return;
      if (isInsideExcludedTypographyAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message: "Em dash (—) in UI text reads like AI output to your users.",
      });
    },
  }),
});
