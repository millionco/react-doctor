import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const HANDLER_PROP_PATTERN = /^on[A-Z]/;

const promiseChainMethodName = (call: EsTreeNodeOfType<"CallExpression">): string | null => {
  const callee = call.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return null;
  }
  return callee.property.name;
};

const isNullishArgument = (argument: EsTreeNode): boolean =>
  (isNodeOfType(argument, "Literal") && argument.value === null) ||
  (isNodeOfType(argument, "Identifier") && argument.name === "undefined");

// True when the chain carries a rejection handler anywhere along it: a
// `.catch(...)` call, or a two-argument `.then(onOk, onErr)` whose
// onRejected is a real handler. `.finally` is NOT a rejection handler —
// it re-throws the rejection.
const chainHasRejectionHandler = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      const methodName = promiseChainMethodName(cursor);
      if (methodName === "catch") return true;
      if (
        methodName === "then" &&
        cursor.arguments.length >= 2 &&
        !isNullishArgument(cursor.arguments[1] as EsTreeNode)
      ) {
        return true;
      }
      cursor = cursor.callee as EsTreeNode;
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

// Returns the last `.then(...)` call when `expression` is a `.then`-ended
// chain (optionally followed by `.finally` calls, which re-throw
// rejections) with no rejection handler, else null. Keyed purely off the
// literal `.then(` shape — no inference about whether a bare call returns
// a promise.
const floatingThenCall = (expression: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  let terminal = stripParenExpression(expression);
  while (
    isNodeOfType(terminal, "CallExpression") &&
    promiseChainMethodName(terminal) === "finally"
  ) {
    const callee = terminal.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return null;
    terminal = stripParenExpression(callee.object as EsTreeNode);
  }
  if (!isNodeOfType(terminal, "CallExpression")) return null;
  if (promiseChainMethodName(terminal) !== "then") return null;
  if (chainHasRejectionHandler(terminal)) return null;
  return terminal;
};

// Discarded expression positions inside the handler: the expression
// itself, the right side of a `&&`/`||`/`??` guard, and both ternary
// branches. `void expr` is an explicit discard and never matches.
const collectExpressionFloatingThenCalls = (
  expression: EsTreeNode,
  found: EsTreeNodeOfType<"CallExpression">[],
): void => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "LogicalExpression")) {
    collectExpressionFloatingThenCalls(stripped.right as EsTreeNode, found);
    return;
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    collectExpressionFloatingThenCalls(stripped.consequent as EsTreeNode, found);
    collectExpressionFloatingThenCalls(stripped.alternate as EsTreeNode, found);
    return;
  }
  const floating = floatingThenCall(stripped);
  if (floating) found.push(floating);
};

// Statements that execute synchronously when the handler fires:
// ExpressionStatements plus both branches of `if` (through nested
// blocks). Nested functions are intentionally NOT descended into — their
// `.then` chains don't run when the handler fires.
const collectStatementFloatingThenCalls = (
  statement: EsTreeNode,
  found: EsTreeNodeOfType<"CallExpression">[],
): void => {
  if (isNodeOfType(statement, "ExpressionStatement")) {
    collectExpressionFloatingThenCalls(statement.expression as EsTreeNode, found);
    return;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    for (const innerStatement of statement.body) {
      collectStatementFloatingThenCalls(innerStatement as EsTreeNode, found);
    }
    return;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    collectStatementFloatingThenCalls(statement.consequent as EsTreeNode, found);
    if (statement.alternate) {
      collectStatementFloatingThenCalls(statement.alternate as EsTreeNode, found);
    }
  }
};

const collectDirectFloatingThenCalls = (
  handler: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
): EsTreeNodeOfType<"CallExpression">[] => {
  const found: EsTreeNodeOfType<"CallExpression">[] = [];
  const body = handler.body as EsTreeNode;
  if (isNodeOfType(body, "BlockStatement")) {
    collectStatementFloatingThenCalls(body, found);
  } else {
    collectExpressionFloatingThenCalls(body, found);
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
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

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
