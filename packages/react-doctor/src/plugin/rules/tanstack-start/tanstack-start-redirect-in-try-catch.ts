import { TANSTACK_REDIRECT_FUNCTIONS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartRedirectInTryCatch = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "warn",
  category: "TanStack Start",
  recommendation:
    "TanStack Router's `redirect()` and `notFound()` throw special errors caught by the router. Move them outside the try block or re-throw in the catch",
  examples: [
    {
      before:
        "try {\n  const user = await load();\n  if (!user) throw redirect({ to: '/login' });\n} catch (e) { log(e); }",
      after:
        "let user;\ntry { user = await load(); } catch (e) { log(e); }\nif (!user) throw redirect({ to: '/login' });",
    },
  ],
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
