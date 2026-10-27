import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { walkInsideStatementBlocks } from "../../../utils/walk-inside-statement-blocks.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { hasClosedCleanupFlagReferences } from "./has-closed-cleanup-flag-references.js";

export const isResourceUnrelatedEffectCleanup = (
  callback: EsTreeNode,
  setupFunctions: readonly EsTreeNode[],
  listener: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(callback) || !isNodeOfType(callback.body, "BlockStatement")) return false;
  const returned: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child) => {
    if (isNodeOfType(child, "ReturnStatement") && child.argument)
      returned.push(stripParenExpression(child.argument));
  });
  for (const cleanup of returned) {
    if (
      (!isNodeOfType(cleanup, "ArrowFunctionExpression") &&
        !isNodeOfType(cleanup, "FunctionExpression")) ||
      cleanup.async ||
      cleanup.generator ||
      cleanup.params.length !== 0 ||
      !isNodeOfType(cleanup.body, "BlockStatement")
    )
      return false;
    for (const statement of cleanup.body.body) {
      if (
        isNodeOfType(statement, "EmptyStatement") ||
        (isNodeOfType(statement, "ReturnStatement") && !statement.argument)
      )
        continue;
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      const expression = stripParenExpression(statement.expression);
      if (
        isNodeOfType(expression, "AssignmentExpression") &&
        expression.operator === "=" &&
        isNodeOfType(expression.left, "Identifier")
      ) {
        const value = stripParenExpression(expression.right);
        const symbol = scopes.symbolFor(expression.left);
        if (
          !isNodeOfType(value, "Literal") ||
          typeof value.value !== "boolean" ||
          !symbol ||
          !hasClosedCleanupFlagReferences(
            symbol,
            callback,
            setupFunctions,
            listener,
            cleanup,
            scopes,
          )
        )
          return false;
        continue;
      }
      if (
        !isNodeOfType(expression, "CallExpression") ||
        expression.optional ||
        !isNodeOfType(expression.callee, "MemberExpression") ||
        expression.callee.computed ||
        expression.callee.optional
      )
        return false;
      const receiver = stripParenExpression(expression.callee.object);
      const method = getStaticPropertyKeyName(expression.callee);
      if (
        !isNodeOfType(receiver, "Identifier") ||
        receiver.name !== "console" ||
        !scopes.isGlobalReference(receiver) ||
        (method !== "log" && method !== "info") ||
        !isProvenUnmodifiedGlobalNamespaceReference(receiver, "console", scopes, method) ||
        !expression.arguments.every(
          (argument) =>
            isNodeOfType(argument, "Literal") &&
            (argument.value === null ||
              typeof argument.value === "string" ||
              typeof argument.value === "number" ||
              typeof argument.value === "boolean"),
        )
      )
        return false;
    }
  }
  return true;
};
