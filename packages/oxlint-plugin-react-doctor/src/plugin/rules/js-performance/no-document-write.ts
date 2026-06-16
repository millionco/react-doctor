import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`document.write()` blocks parsing, is ignored (or wipes the page) after load, and is flagged by browsers as a performance anti-pattern. Build DOM nodes or set `innerHTML`/`textContent` on a target element instead.";

const WRITE_METHODS = new Set(["write", "writeln"]);

// `document.write(...)` / `document.writeln(...)` with a non-computed
// `document` member callee.
export const noDocumentWrite = defineRule({
  id: "no-document-write",
  title: "document.write/writeln",
  severity: "warn",
  recommendation:
    "Don't use `document.write()`/`document.writeln()`. Append DOM nodes or set `innerHTML`/`textContent` on a specific element instead.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "document") return;
      if (
        !isNodeOfType(callee.property, "Identifier") ||
        !WRITE_METHODS.has(callee.property.name)
      ) {
        return;
      }
      context.report({ node, message: MESSAGE });
    },
  }),
});
