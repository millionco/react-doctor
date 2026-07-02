import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
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
// stay quiet. `term(?!in)` keeps `searchTerm` while excluding
// `terminalSequence` / `terminate`-shaped names.
const SEARCH_TERM_NAME_PATTERN = /search|query|highlight|filter|term(?!in)|keyword/i;

// An escape helper applied to the value makes the pattern safe. Also treat
// `.replace(...)` / `.replaceAll(...)` as author-driven sanitization.
const ESCAPE_HELPER_NAME_PATTERN = /escape.*reg|safe.*reg/i;

// A binding named like `escapedSearchString` is an explicit author claim
// that the value was sanitized before construction.
const SANITIZED_NAME_PATTERN = /escap|sanitiz/i;

// How many identifier-to-initializer hops to follow when checking whether
// a binding was escaped on a prior line (`const escaped = escapeRegExp(q);
// const pattern = escaped; new RegExp(pattern)`).
const INITIALIZER_RESOLUTION_HOPS = 2;

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

const isRegExpEscapeBuiltin = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  isNodeOfType(callee.object, "Identifier") &&
  callee.object.name === "RegExp" &&
  isNodeOfType(callee.property, "Identifier") &&
  callee.property.name === "escape";

const isEscapingCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isRegExpEscapeBuiltin(node.callee)) return true;
  const calleeName = getCalleeName(node);
  return Boolean(
    calleeName &&
    (ESCAPE_HELPER_NAME_PATTERN.test(calleeName) ||
      calleeName === "replace" ||
      calleeName === "replaceAll"),
  );
};

const isRegexSourceAccess = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "source";

const collectRawSearchTermIdentifiers = (
  argument: EsTreeNode,
): EsTreeNodeOfType<"Identifier">[] => {
  const rawSearchTermIdentifiers: EsTreeNodeOfType<"Identifier">[] = [];
  walkAst(argument, (child: EsTreeNode) => {
    if (isEscapingCall(child) || isRegexSourceAccess(child)) return false;
    if (isNodeOfType(child, "Identifier") && SEARCH_TERM_NAME_PATTERN.test(child.name)) {
      rawSearchTermIdentifiers.push(child);
    }
  });
  return rawSearchTermIdentifiers;
};

const initializerLooksEscaped = (initializer: EsTreeNode, remainingHops: number): boolean => {
  const strippedInitializer = stripParenExpression(initializer);
  if (isFullyLiteralPattern(strippedInitializer)) return true;
  let didFindEscapingCall = false;
  walkAst(strippedInitializer, (child: EsTreeNode) => {
    if (isEscapingCall(child)) didFindEscapingCall = true;
  });
  if (didFindEscapingCall) return true;
  if (remainingHops > 0 && isNodeOfType(strippedInitializer, "Identifier")) {
    return identifierResolvesToEscapedValue(strippedInitializer, remainingHops - 1);
  }
  return false;
};

const identifierResolvesToEscapedValue = (
  identifier: EsTreeNodeOfType<"Identifier">,
  remainingHops: number,
): boolean => {
  if (SANITIZED_NAME_PATTERN.test(identifier.name)) return true;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return false;
  return initializerLooksEscaped(binding.initializer, remainingHops);
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
      const rawSearchTermIdentifiers = collectRawSearchTermIdentifiers(firstArgument);
      const hasUnescapedSearchTerm = rawSearchTermIdentifiers.some(
        (identifier) => !identifierResolvesToEscapedValue(identifier, INITIALIZER_RESOLUTION_HOPS),
      );
      if (!hasUnescapedSearchTerm) return;
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
