import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoRedirectInTryCatch = defineRule<Rule>({
  id: "nextjs-no-redirect-in-try-catch",
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "Move the redirect/notFound call outside the try block, or add `unstable_rethrow(error)` in the catch",
  examples: [
    {
      before: "try {\n  await save();\n  redirect('/done');\n} catch (e) {\n  log(e);\n}",
      after: "try {\n  await save();\n} catch (e) {\n  log(e);\n}\nredirect('/done');",
    },
  ],
  create: (context: RuleContext) => {
    let tryCatchDepth = 0;

    return {
      TryStatement() {
        tryCatchDepth++;
      },
      "TryStatement:exit"() {
        tryCatchDepth--;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (tryCatchDepth === 0) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!NEXTJS_NAVIGATION_FUNCTIONS.has(node.callee.name)) return;

        context.report({
          node,
          message: `${node.callee.name}() inside try-catch — this throws a special error Next.js handles internally. Move it outside the try block or use unstable_rethrow() in the catch`,
        });
      },
    };
  },
});
