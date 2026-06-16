import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "A synchronous `XMLHttpRequest` (`.open(method, url, false)`) freezes the main thread until the request finishes, blocking all rendering and input. Use `fetch()` or an async XHR (`open(method, url, true)`).";

const isFalseLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === false;

// `<receiver>.open(method, url, false)` — the canonical synchronous-XHR
// signature. The literal `false` third argument (the `async` flag) is the
// distinctive, high-precision marker; we don't need to prove the receiver is
// an XMLHttpRequest.
export const noSyncXhr = defineRule({
  id: "no-sync-xhr",
  title: "Synchronous XMLHttpRequest",
  severity: "warn",
  recommendation:
    "Never open an XMLHttpRequest synchronously (`async` = `false`). It blocks the main thread. Use `fetch()` or pass `true` and handle the response asynchronously.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "open") return;
      const asyncArgument = node.arguments?.[2];
      if (!asyncArgument || !isFalseLiteral(stripParenExpression(asyncArgument))) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
