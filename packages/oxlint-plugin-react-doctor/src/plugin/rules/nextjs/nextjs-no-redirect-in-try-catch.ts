import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
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
      const navigationReference = resolveImportedApiReference(node.callee, context.scopes);
      if (
        navigationReference?.source !== "next/navigation" ||
        !navigationReference.importedName ||
        !NEXTJS_NAVIGATION_FUNCTIONS.has(navigationReference.importedName)
      )
        return;

      const frameworkRethrowPredicate = (
        expression: EsTreeNodeOfType<"CallExpression">,
        caughtBinding: EsTreeNodeOfType<"Identifier">,
      ): boolean => {
        const rethrowReference = resolveImportedApiReference(expression.callee, context.scopes);
        if (
          rethrowReference?.source !== "next/navigation" ||
          rethrowReference.importedName !== "unstable_rethrow"
        )
          return false;
        const argument = expression.arguments[0];
        if (!isNodeOfType(argument, "Identifier")) return false;
        const caughtSymbol = context.scopes.symbolFor(caughtBinding);
        return Boolean(caughtSymbol && context.scopes.symbolFor(argument) === caughtSymbol);
      };

      const guardingTry = findGuardingTryStatement(node, frameworkRethrowPredicate);
      if (!guardingTry) return;

      context.report({
        node,
        message: `${navigationReference.importedName}() inside try-catch gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
