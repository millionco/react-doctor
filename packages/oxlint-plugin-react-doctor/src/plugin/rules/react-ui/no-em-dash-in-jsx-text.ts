import { EM_DASH_PROSE_MIN_WORD_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isInsideStaticallyHiddenJsxSubtree } from "../../utils/is-inside-statically-hidden-jsx-subtree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isInsideExcludedTypographyAncestor } from "./utils/is-inside-excluded-typography-ancestor.js";

const EM_DASH = "—";
const EM_DASH_ENTITY_PATTERN = /&(?:mdash|#0*8212|#x0*2014);/gi;
const LONG_FORM_CONTENT_PATH_PATTERN =
  /(?:^|[/\\])(?:articles?|blog|changelog|content|docs?|posts?)(?:[/\\]|$)/i;
const PROSE_EM_DASH_PATTERN = /\p{L}[^—\n]*—[^—\n]*\p{L}/u;
const LETTER_WORD_PATTERN = /\p{L}+/gu;
const LINE_BREAK_PATTERN = /[\r\n]/u;

const hasProseEmDash = (text: string): boolean =>
  text.includes(EM_DASH) &&
  text
    .split(LINE_BREAK_PATTERN)
    .some(
      (line) =>
        PROSE_EM_DASH_PATTERN.test(line) &&
        (line.match(LETTER_WORD_PATTERN)?.length ?? 0) >= EM_DASH_PROSE_MIN_WORD_COUNT,
    );

const hasProseEmDashInStaticExpression = (rawExpression: EsTreeNode): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) {
    return typeof expression.value === "string" && hasProseEmDash(expression.value);
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return expression.quasis.some((quasi) =>
      hasProseEmDash(quasi.value.cooked ?? quasi.value.raw ?? ""),
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      hasProseEmDashInStaticExpression(expression.consequent) ||
      hasProseEmDashInStaticExpression(expression.alternate)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return hasProseEmDashInStaticExpression(expression.right);
  }
  return false;
};

export const noEmDashInJsxText = defineRule({
  id: "design-no-em-dash-in-jsx-text",
  title: "Em dash in JSX text",
  tags: ["design", "test-noise"],
  severity: "warn",
  defaultEnabled: false,
  category: "Architecture",
  recommendation:
    "Replace em dashes in UI text with commas, colons, semicolons, or parentheses so the copy reads less like AI output.",
  create: (context: RuleContext): RuleVisitors => {
    if (context.filename && LONG_FORM_CONTENT_PATH_PATTERN.test(context.filename)) return {};
    return {
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        if (node.parent && isNodeOfType(node.parent, "JSXAttribute")) return;
        if (isInsideExcludedTypographyAncestor(node)) return;
        if (isInsideStaticallyHiddenJsxSubtree(node, context)) return;
        if (!hasProseEmDashInStaticExpression(node.expression)) return;
        context.report({
          node,
          message: "Em dash (—) in UI text reads like AI output to your users.",
        });
      },
      JSXText(node: EsTreeNodeOfType<"JSXText">) {
        const sourceText = typeof node.value === "string" ? node.value : "";
        const renderedText = sourceText.replace(EM_DASH_ENTITY_PATTERN, EM_DASH);
        if (!hasProseEmDash(renderedText)) return;
        if (isInsideExcludedTypographyAncestor(node)) return;
        if (isInsideStaticallyHiddenJsxSubtree(node, context)) return;
        context.report({
          node,
          message: "Em dash (—) in UI text reads like AI output to your users.",
        });
      },
    };
  },
});
