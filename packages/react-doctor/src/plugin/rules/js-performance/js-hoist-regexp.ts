import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsHoistRegexp = defineRule<Rule>({
  id: "js-hoist-regexp",
  severity: "warn",
  recommendation:
    "Hoist `new RegExp(...)` (or large regex literals) to a module-level constant so it isn't recompiled on every loop iteration",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "RegExp") {
          context.report({
            node,
            message: "new RegExp() inside a loop — hoist to a module-level constant",
          });
        }
      },
    }),
});
