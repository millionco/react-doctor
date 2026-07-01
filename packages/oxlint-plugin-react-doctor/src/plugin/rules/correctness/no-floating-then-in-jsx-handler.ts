import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const HANDLER_PROP_PATTERN = /^on[A-Z]/;

// True when a promise chain carries its own rejection/settlement handler
// anywhere along it (`.catch`/`.finally`), so a trailing `.then` is
// managed, not floating.
const chainHasCatchOrFinally = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee = cursor.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        (callee.property.name === "catch" || callee.property.name === "finally")
      ) {
        return true;
      }
      cursor = callee as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object as EsTreeNode;
      continue;
    }
    break;
  }
  return false;
};

// Returns the terminating `.then(handler)` call when `expression` is a
// single-argument `.then`-ended chain with no `.catch`/`.finally`, else
// null. Keyed purely off the literal `.then(` shape — no inference about
// whether a bare call returns a promise.
const floatingThenCall = (
  expression: EsTreeNode
): EsTreeNodeOfType<"CallExpression"> | null => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return null;
  const callee = stripped.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "then"
  ) {
    return null;
  }
  // A second (onRejected) argument handles the rejection.
  if (stripped.arguments.length !== 1) return null;
  if (chainHasCatchOrFinally(stripped)) return null;
  return stripped;
};

// The handler's directly-executed statements: a concise arrow body is the
// expression itself; a block body contributes only its top-level
// ExpressionStatements. Nested functions are intentionally NOT descended
// into — their `.then` chains don't run when the handler fires.
const collectDirectFloatingThenCalls = (
  handler:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
): EsTreeNodeOfType<"CallExpression">[] => {
  const body = handler.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    // Concise arrow body — a bare fire-and-forget expression. `void expr`
    // is an explicit discard and is excluded.
    if (isNodeOfType(body, "UnaryExpression") && body.operator === "void")
      return [];
    const floating = floatingThenCall(body);
    return floating ? [floating] : [];
  }
  const found: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const statement of body.body) {
    if (!isNodeOfType(statement as EsTreeNode, "ExpressionStatement")) continue;
    const expression = (statement as EsTreeNodeOfType<"ExpressionStatement">)
      .expression;
    if (isNodeOfType(expression as EsTreeNode, "UnaryExpression")) continue;
    const floating = floatingThenCall(expression as EsTreeNode);
    if (floating) found.push(floating);
  }
  return found;
};

export const noFloatingThenInJsxHandler = defineRule({
  id: "no-floating-then-in-jsx-handler",
  title: "Floating .then in a JSX event handler",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A `.then()` chain with no `.catch` in an event handler becomes an uncaught promise rejection no error boundary can catch; add a `.catch` handler (or make the handler `async` and `try/catch`).",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const name = getJsxAttributeName(node.name as EsTreeNode);
      if (!name || !HANDLER_PROP_PATTERN.test(name)) return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer"))
        return;

      const handler = stripParenExpression(node.value.expression as EsTreeNode);
      if (
        !isNodeOfType(handler, "ArrowFunctionExpression") &&
        !isNodeOfType(handler, "FunctionExpression")
      ) {
        return;
      }
      // An `async` handler propagates rejections differently (its own
      // promise), so it's out of scope.
      if (handler.async) return;

      for (const floating of collectDirectFloatingThenCalls(handler)) {
        context.report({
          node: floating,
          message:
            "This `.then()` runs in an event handler with no `.catch`, so a rejection becomes an uncaught promise error no React error boundary can catch — add a `.catch` handler or make the handler `async` with `try/catch`.",
        });
      }
    },
  }),
});
