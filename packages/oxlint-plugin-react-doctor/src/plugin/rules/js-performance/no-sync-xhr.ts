import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const MESSAGE =
  "A synchronous `XMLHttpRequest` (`.open(method, url, false)`) freezes the main thread until the request finishes, blocking all rendering and input. Use `fetch()` or an async XHR (`open(method, url, true)`).";

const isFalseLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === false;

// `public/` holds static assets served verbatim — vendored/generated
// third-party output (emscripten runtimes, worker scripts) the project does
// not author, where sync XHR typically runs inside a worker guard and
// rewriting the generated file is not an applicable fix.
const PUBLIC_ASSET_PATH_PATTERN = /(?:^|\/)public\//i;

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
  create: (context: RuleContext): RuleVisitors => {
    if (PUBLIC_ASSET_PATH_PATTERN.test(context.filename ?? "")) return {};
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = node.callee;
        if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
        if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "open") {
          return;
        }
        const asyncArgument = node.arguments?.[2];
        if (!asyncArgument || !isFalseLiteral(stripParenExpression(asyncArgument))) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
