import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Only the `try` BLOCK swallows a thrown redirect — its `catch` handler wraps
// it. A `redirect()` called from inside a `catch` (or `finally`) propagates
// normally and is valid/idiomatic, so it must NOT be reported.
const isInsideGuardedTryBlock = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      Boolean(ancestor.handler)
    ) {
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
      if (!isInsideGuardedTryBlock(node)) return;

      context.report({
        node,
        message: `${node.callee.name}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
