import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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

      // findGuardingTryStatement resolves the try/catch that actually
      // swallows the thrown control-flow error, climbing past re-throwing
      // catches, bare try/finally, and IIFE boundaries.
      const guardingTry = findGuardingTryStatement(node);
      if (!guardingTry) return;

      context.report({
        node,
        message: `${node.callee.name}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
