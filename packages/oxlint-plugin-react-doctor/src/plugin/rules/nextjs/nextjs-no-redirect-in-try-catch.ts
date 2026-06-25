import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A navigation call's control-flow error is only swallowed when the call sits
// in the `try` BLOCK of a statement that has a `catch` handler — a call in the
// `catch`/`finally`, or in a `try` whose only companion is `finally`, escapes
// untouched. So we walk the ancestry for the nearest such enclosing try rather
// than counting raw try-nesting depth (which over-reports all three cases).
const isInsideSwallowingTry = (callExpression: EsTreeNode): boolean => {
  let child: EsTreeNode = callExpression;
  let ancestor = callExpression.parent ?? null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.handler && ancestor.block === child) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
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
      if (!NEXTJS_NAVIGATION_FUNCTIONS.has(node.callee.name)) return;
      if (!isInsideSwallowingTry(node)) return;

      context.report({
        node,
        message: `${node.callee.name}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
