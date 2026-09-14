import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";

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
      const importedName = getImportedNameFromModule(node, node.callee.name, "next/navigation");
      if (!importedName || !NEXTJS_NAVIGATION_FUNCTIONS.has(importedName)) return;

      const frameworkRethrowPredicate = (
        throwStatement: EsTreeNodeOfType<"ThrowStatement">,
        caughtBindingName: string,
      ): boolean => {
        const parent = throwStatement.parent;
        if (!isNodeOfType(parent, "ExpressionStatement")) return false;
        const expression = parent.expression;
        if (!isNodeOfType(expression, "CallExpression")) return false;
        
        const rethrowRef = resolveImportedApiReference(expression.callee, context.scopes);
        if (
          !rethrowRef ||
          rethrowRef.source !== "next/navigation" ||
          rethrowRef.importedName !== "unstable_rethrow"
        ) {
          return false;
        }

        const firstArg = expression.arguments[0];
        if (!firstArg || isNodeOfType(firstArg, "SpreadElement")) return false;
        if (!isNodeOfType(firstArg, "Identifier")) return false;
        return firstArg.name === caughtBindingName;
      };

      const guardingTry = findGuardingTryStatement(node, frameworkRethrowPredicate);
      if (!guardingTry) return;

      context.report({
        node,
        message: `${node.callee.name}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
