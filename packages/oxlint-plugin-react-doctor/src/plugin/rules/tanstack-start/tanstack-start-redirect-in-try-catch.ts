import { TANSTACK_REDIRECT_FUNCTIONS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartRedirectInTryCatch = defineRule({
  id: "tanstack-start-redirect-in-try-catch",
  title: "redirect() inside try-catch",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "TanStack Router's `redirect()` and `notFound()` throw special errors caught by the router. Move them outside the try block or re-throw in the catch",
  create: (context: RuleContext) => ({
    ThrowStatement(node: EsTreeNodeOfType<"ThrowStatement">) {
      const argument = node.argument;
      if (!isNodeOfType(argument, "CallExpression")) return;
      if (!isNodeOfType(argument.callee, "Identifier")) return;
      if (!TANSTACK_REDIRECT_FUNCTIONS.has(argument.callee.name)) return;

      // findGuardingTryStatement resolves the try/catch that actually
      // swallows the router's control-flow error, climbing past re-throwing
      // catches, bare try/finally, and IIFE boundaries.
      const guardingTry = findGuardingTryStatement(node);
      if (!guardingTry) return;

      context.report({
        node,
        message: `throw ${argument.callee.name}() inside a try block gets swallowed, so the redirect silently fails.`,
      });
    },
  }),
});
