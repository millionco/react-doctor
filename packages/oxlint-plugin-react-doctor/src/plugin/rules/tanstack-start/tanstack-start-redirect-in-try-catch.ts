import { TANSTACK_REDIRECT_FUNCTIONS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A catch clause forwards the router's control-flow error only when it
// re-throws the CAUGHT binding (`throw error`, e.g. the documented
// `if (isRedirect(error)) throw error`). A bare `isRedirect(error)` check that
// is NOT followed by a rethrow — or a catch that only logs/returns — still
// swallows the redirect and must be flagged. Nested functions are pruned so a
// `throw` inside a callback (which runs later) doesn't count as a rethrow.
const catchClauseForwardsRedirect = (handler: EsTreeNodeOfType<"CatchClause">): boolean => {
  const caughtBindingName = isNodeOfType(handler.param, "Identifier") ? handler.param.name : null;
  if (!caughtBindingName) return false;
  let forwards = false;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (forwards) return false;
    if (
      child !== handler.body &&
      (isNodeOfType(child, "ArrowFunctionExpression") ||
        isNodeOfType(child, "FunctionExpression") ||
        isNodeOfType(child, "FunctionDeclaration"))
    ) {
      return false;
    }
    if (
      isNodeOfType(child, "ThrowStatement") &&
      isNodeOfType(child.argument, "Identifier") &&
      child.argument.name === caughtBindingName
    ) {
      forwards = true;
      return false;
    }
  });
  return forwards;
};

// Walks up from a `throw redirect()` to the nearest enclosing TryStatement
// whose try block contains it. Returns null when the throw lives inside a
// catch clause (already past the swallowing boundary) or outside any try.
const findEnclosingTryForThrow = (node: EsTreeNode): EsTreeNodeOfType<"TryStatement"> | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "CatchClause")) return null;
    // Stop at a function boundary: a `throw` inside a `setTimeout(() => …)` or
    // any other nested callback runs LATER, so the surrounding synchronous
    // try/catch can never catch it — not the swallowing pattern this flags.
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      return null;
    }
    if (isNodeOfType(cursor, "TryStatement")) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

export const tanstackStartRedirectInTryCatch = defineRule({
  id: "tanstack-start-redirect-in-try-catch",
  title: "redirect() inside try-catch",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "TanStack Router's `redirect()` and `notFound()` throw special errors caught by the router. Move them outside the try block or re-throw in the catch",
  create: (context: RuleContext) => ({
    ThrowStatement(node: EsTreeNodeOfType<"ThrowStatement">) {
      const argument = node.argument;
      if (!isNodeOfType(argument, "CallExpression")) return;
      if (!isNodeOfType(argument.callee, "Identifier")) return;
      if (!TANSTACK_REDIRECT_FUNCTIONS.has(argument.callee.name)) return;

      const enclosingTry = findEnclosingTryForThrow(node);
      if (!enclosingTry) return;
      if (enclosingTry.handler && catchClauseForwardsRedirect(enclosingTry.handler)) return;

      context.report({
        node,
        message: `throw ${argument.callee.name}() inside a try block gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
