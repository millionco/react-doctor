import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { catchClauseRethrowsCaught } from "../../utils/catch-clause-rethrows-caught.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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
    if (isFunctionLike(ancestor)) {
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
      if (catchClauseRethrowsCaught(guardingTry.handler)) return;

      context.report({
        node,
        message: `${node.callee.name}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
