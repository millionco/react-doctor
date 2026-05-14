import { NEXTJS_NAVIGATION_FUNCTIONS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const nextjsNoRedirectInTryCatch = defineRule<Rule>({
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "Move the redirect/notFound call outside the try block, or add `unstable_rethrow(error)` in the catch",
  create: (context: RuleContext) => {
    let tryCatchDepth = 0;

    return {
      TryStatement() {
        tryCatchDepth++;
      },
      "TryStatement:exit"() {
        tryCatchDepth--;
      },
      CallExpression(node: EsTreeNode) {
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
