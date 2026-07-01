import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Identifier names that resolve the RegExp source to a user/config search,
// filter, highlight, or query term (the values that carry unescaped regex
// metacharacters). Kept deliberately narrow so controlled/constant sources
// stay quiet.
const SEARCH_TERM_NAME_PATTERN = /search|query|highlight|filter|term|keyword/i;

// An escape helper applied to the value in the same expression makes the
// pattern safe. Also treat `.replace(...)` as author-driven sanitization.
const ESCAPE_HELPER_NAME_PATTERN = /escape.*reg|safe.*reg/i;

const isRegExpConstruction = (node: EsTreeNode): boolean => {
  const callee = isNodeOfType(node, "CallExpression")
    ? node.callee
    : isNodeOfType(node, "NewExpression")
      ? node.callee
      : null;
  return Boolean(callee && isNodeOfType(callee, "Identifier") && callee.name === "RegExp");
};

const isFullyLiteralPattern = (argument: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Literal")) return true;
  if (isNodeOfType(stripped, "TemplateLiteral") && (stripped.expressions?.length ?? 0) === 0) {
    return true;
  }
  return false;
};

const argumentHasSearchTermSignal = (argument: EsTreeNode): boolean => {
  let hasSignal = false;
  walkAst(argument, (child: EsTreeNode) => {
    if (isNodeOfType(child, "Identifier") && SEARCH_TERM_NAME_PATTERN.test(child.name)) {
      hasSignal = true;
    }
  });
  return hasSignal;
};

const expressionAppliesEscapeHelper = (argument: EsTreeNode): boolean => {
  let escaped = false;
  walkAst(argument, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const calleeName = getCalleeName(child);
    if (calleeName && (ESCAPE_HELPER_NAME_PATTERN.test(calleeName) || calleeName === "replace")) {
      escaped = true;
    }
  });
  return escaped;
};

export const noUnescapedDynamicStringInRegexp = defineRule({
  id: "no-unescaped-dynamic-string-in-regexp",
  title: "Unescaped dynamic string in RegExp constructor",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A search/filter/highlight term dropped straight into `new RegExp(...)` lets its regex metacharacters act as operators, so a user typing `.` or `(` over-matches or throws. Escape the value with an `escapeRegExp` helper before constructing the pattern.",
  create: (context: RuleContext) => {
    const reportUnescapedConstruction = (
      node: EsTreeNodeOfType<"CallExpression"> | EsTreeNodeOfType<"NewExpression">,
    ): void => {
      if (!isRegExpConstruction(node)) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return;
      if (isFullyLiteralPattern(firstArgument)) return;
      if (!argumentHasSearchTermSignal(firstArgument)) return;
      if (expressionAppliesEscapeHelper(firstArgument)) return;
      if (isInsideTryStatement(node, { region: "block" })) return;
      context.report({
        node,
        message:
          "This builds a `RegExp` from a dynamic search/filter term without escaping it, so regex metacharacters in the value act as operators and over-match or throw. Escape the value with an `escapeRegExp` helper first.",
      });
    };
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        reportUnescapedConstruction(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        reportUnescapedConstruction(node);
      },
    };
  },
});
