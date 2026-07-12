import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { createMethodMutationAnalysis } from "../../utils/has-proven-method-mutation.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "A synchronous `XMLHttpRequest` (`.open(method, url, false)`) freezes the main thread until the request finishes, blocking all rendering and input. Use `fetch()` or an async XHR (`open(method, url, true)`).";

const isFalseLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === false;

// `public/` holds static assets served verbatim — vendored/generated
// third-party output (emscripten runtimes, worker scripts) the project does
// not author, where sync XHR typically runs inside a worker guard and
// rewriting the generated file is not an applicable fix.
const PUBLIC_ASSET_PATH_PATTERN = /(?:^|\/)public\//i;

export const noSyncXhr = defineRule({
  id: "no-sync-xhr",
  title: "Synchronous XMLHttpRequest",
  severity: "warn",
  recommendation:
    "Never open an XMLHttpRequest synchronously (`async` = `false`). It blocks the main thread. Use `fetch()` or pass `true` and handle the response asynchronously.",
  create: (context: RuleContext): RuleVisitors => {
    if (PUBLIC_ASSET_PATH_PATTERN.test(context.filename ?? "")) return {};
    const methodMutationAnalysis = createMethodMutationAnalysis(context);
    const openCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    const analyzeOpenCall = (node: EsTreeNodeOfType<"CallExpression">): void => {
      const callee = stripParenExpression(node.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return;
      if (!isProvenBrowserApiReceiver(callee.object, "xml-http-request", context.scopes)) return;
      if (
        methodMutationAnalysis.hasProvenMutation(
          callee.object,
          "open",
          node,
          ["XMLHttpRequest"],
          (replacement) =>
            isProvenBrowserApiReceiver(replacement, "xml-http-request", context.scopes),
        )
      ) {
        return;
      }
      const asyncArgument = node.arguments[2];
      if (!asyncArgument || !isFalseLiteral(stripParenExpression(asyncArgument))) return;
      context.report({ node, message: MESSAGE });
    };
    return {
      AssignmentExpression(node: EsTreeNode) {
        methodMutationAnalysis.record(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        methodMutationAnalysis.record(node);
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
        if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "open") {
          return;
        }
        openCalls.push(node);
      },
      UnaryExpression(node: EsTreeNode) {
        methodMutationAnalysis.record(node);
      },
      "Program:exit"() {
        for (const node of openCalls) analyzeOpenCall(node);
      },
    };
  },
});
