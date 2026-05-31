import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsHoistRegexp = defineRule<Rule>({
  id: "js-hoist-regexp",
  title: "RegExp built inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move `new RegExp(...)` (or large regex literals) to a constant outside the loop so it isn't rebuilt on every pass",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "RegExp") {
          context.report({
            node,
            message:
              "This slows the loop because new RegExp() rebuilds the pattern every pass, so move it to a constant outside the loop",
          });
        }
      },
    }),
});
