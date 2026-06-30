import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// The enclosing TryStatement whose `try` BLOCK contains `node`, or null. Only
// the `try` block swallows a thrown redirect — its `catch` handler wraps it. A
// `redirect()` called from inside a `catch` (or `finally`) propagates normally
// and is valid/idiomatic, so it must NOT be reported. A `redirect()` defined
// inside a nested function (event handler, callback, returned render closure)
// runs later, outside the try's synchronous scope — so stop at the first
// enclosing function boundary before reaching the TryStatement.
const findGuardingTryStatement = (node: EsTreeNode): EsTreeNodeOfType<"TryStatement"> | null => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "FunctionDeclaration") ||
      isNodeOfType(ancestor, "FunctionExpression") ||
      isNodeOfType(ancestor, "ArrowFunctionExpression")
    ) {
      return null;
    }
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      Boolean(ancestor.handler)
    ) {
      return ancestor;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// A catch clause that re-throws the CAUGHT binding (`throw e`, pruning nested
// functions) forwards the redirect's control-flow error instead of swallowing
// it — the documented safe pattern (`if (isRedirectError(e)) throw e`). A catch
// that only logs/returns, or throws a FRESH error (`throw new Error(...)`),
// genuinely swallows the redirect's control-flow error and must still flag.
const catchClauseRethrows = (handler: EsTreeNodeOfType<"CatchClause">): boolean => {
  const caughtBindingName = isNodeOfType(handler.param, "Identifier") ? handler.param.name : null;
  if (!caughtBindingName) return false;
  let didRethrow = false;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (didRethrow) return false;
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
      didRethrow = true;
      return false;
    }
  });
  return didRethrow;
};

export const nextjsNoRedirectInTryCatch = defineRule({
  id: "nextjs-no-redirect-in-try-catch",
  title: "redirect() inside try-catch",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Move `redirect()` or `notFound()` outside the try block, or rethrow in `catch`, because these APIs throw control-flow errors that catch blocks swallow.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier")) return;
      // Resolve to the actual next/navigation export so a local function of the
      // same name (`const redirect = ...`) is never flagged.
      const importedName = getImportedNameFromModule(node, node.callee.name, "next/navigation");
      if (!importedName || !NEXTJS_NAVIGATION_FUNCTIONS.has(importedName)) return;

      const guardingTry = findGuardingTryStatement(node);
      if (!guardingTry?.handler) return;
      if (catchClauseRethrows(guardingTry.handler)) return;

      context.report({
        node,
        message: `${node.callee.name}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
