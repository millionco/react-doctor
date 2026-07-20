import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const HANDLER_PROP_PATTERN = /^on[A-Z]/;

const getCallMethodName = (callee: EsTreeNode): string | null =>
  isNodeOfType(callee, "MemberExpression") ? getStaticPropertyName(callee) : null;

// Returns the terminal `.then(...)` when it lacks a later callable
// `.catch(...)`. Earlier rejection handlers do not cover errors thrown by
// a subsequent fulfillment handler, and `.finally(...)` rethrows.
const isCallableHandler = (node: EsTreeNode | undefined): boolean => {
  if (!node) return false;
  const handler = stripParenExpression(node);
  return (
    isFunctionLike(handler) ||
    isNodeOfType(handler, "Identifier") ||
    isNodeOfType(handler, "MemberExpression")
  );
};

const floatingThenCall = (expression: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  let terminal = stripParenExpression(expression);
  while (
    isNodeOfType(terminal, "CallExpression") &&
    getCallMethodName(terminal.callee as EsTreeNode) === "finally"
  ) {
    const callee = terminal.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return null;
    terminal = stripParenExpression(callee.object as EsTreeNode);
  }
  while (
    isNodeOfType(terminal, "CallExpression") &&
    getCallMethodName(terminal.callee as EsTreeNode) === "catch"
  ) {
    if (isCallableHandler(terminal.arguments[0] as EsTreeNode | undefined)) return null;
    const callee = terminal.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return null;
    terminal = stripParenExpression(callee.object as EsTreeNode);
  }
  if (!isNodeOfType(terminal, "CallExpression")) return null;
  if (getCallMethodName(terminal.callee as EsTreeNode) !== "then") return null;
  return terminal;
};

// Discarded expression positions inside the handler: the expression
// itself, the right side of a `&&`/`||`/`??` guard, and both ternary
// branches. `void expr` still leaves rejections unhandled.
const collectExpressionFloatingThenCalls = (
  expression: EsTreeNode,
  found: EsTreeNodeOfType<"CallExpression">[],
): void => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "UnaryExpression") && stripped.operator === "void") {
    collectExpressionFloatingThenCalls(stripped.argument, found);
    return;
  }
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

// Nested functions are intentionally excluded because their chains do
// not execute when the handler fires.
const collectDirectFloatingThenCalls = (
  handler: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
): EsTreeNodeOfType<"CallExpression">[] => {
  const found: EsTreeNodeOfType<"CallExpression">[] = [];
  const body = handler.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    collectExpressionFloatingThenCalls(body, found);
    return found;
  }
  walkAst(body, (statement) => {
    if (statement !== body && isFunctionLike(statement)) return false;
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      collectExpressionFloatingThenCalls(statement.argument, found);
      return false;
    }
    if (isNodeOfType(statement, "ExpressionStatement")) {
      collectExpressionFloatingThenCalls(statement.expression as EsTreeNode, found);
      return false;
    }
    return undefined;
  });
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
      // A component prop (`<ConfirmDialog onConfirm={() => save().then(...)}/>`)
      // hands the chain to a consumer that may await it — only intrinsic DOM
      // handlers discard the returned promise unconditionally.
      const openingElement = node.parent;
      if (
        !openingElement ||
        !isNodeOfType(openingElement, "JSXOpeningElement") ||
        !isNodeOfType(openingElement.name, "JSXIdentifier") ||
        !/^[a-z]/.test(openingElement.name.name)
      ) {
        return;
      }
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const handler = stripParenExpression(node.value.expression as EsTreeNode);
      if (
        !isNodeOfType(handler, "ArrowFunctionExpression") &&
        !isNodeOfType(handler, "FunctionExpression")
      ) {
        return;
      }
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
