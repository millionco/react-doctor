import { defineRule } from "../../utils/define-rule.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`document.write()` blocks parsing, is ignored (or wipes the page) after load, and is flagged by browsers as a performance anti-pattern. Build DOM nodes or set `innerHTML`/`textContent` on a target element instead.";

const WRITE_METHODS = new Set(["write", "writeln"]);

const isGlobalDocumentReference = (node: EsTreeNodeOfType<"Identifier">, context: RuleContext) =>
  node.name === "document" && context.scopes.isGlobalReference(node);

export const noDocumentWrite = defineRule({
  id: "no-document-write",
  title: "document.write/writeln",
  severity: "warn",
  recommendation:
    "Don't use `document.write()`/`document.writeln()`. Append DOM nodes or set `innerHTML`/`textContent` on a specific element instead.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return;
      const receiver = stripParenExpression(callee.object);
      if (!isNodeOfType(receiver, "Identifier") || !isGlobalDocumentReference(receiver, context)) {
        return;
      }
      const methodName = getStaticPropertyName(callee);
      if (methodName === null || !WRITE_METHODS.has(methodName)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
