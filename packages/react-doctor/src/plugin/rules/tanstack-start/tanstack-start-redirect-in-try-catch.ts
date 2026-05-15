import { TANSTACK_REDIRECT_FUNCTIONS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartRedirectInTryCatch = defineRule<Rule>({
  id: "tanstack-start-redirect-in-try-catch",
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "TanStack Router's `redirect()` and `notFound()` throw special errors caught by the router. Move them outside the try block or re-throw in the catch",
  create: (context: RuleContext) => {
    let tryBlockDepth = 0;
    let catchClauseDepth = 0;

    return {
      TryStatement() {
        tryBlockDepth++;
      },
      "TryStatement:exit"() {
        tryBlockDepth--;
      },
      CatchClause() {
        catchClauseDepth++;
      },
      "CatchClause:exit"() {
        catchClauseDepth--;
      },
      ThrowStatement(node: EsTreeNodeOfType<"ThrowStatement">) {
        if (tryBlockDepth === 0) return;
        if (catchClauseDepth > 0) return;

        const argument = node.argument;
        if (!isNodeOfType(argument, "CallExpression")) return;
        if (!isNodeOfType(argument.callee, "Identifier")) return;
        if (!TANSTACK_REDIRECT_FUNCTIONS.has(argument.callee.name)) return;

        context.report({
          node,
          message: `throw ${argument.callee.name}() inside try block — the router catches this internally. Move it outside the try block or re-throw in the catch`,
        });
      },
    };
  },
});
