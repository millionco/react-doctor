import { DEEP_NESTING_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsEarlyExit = defineRule<Rule>({
  id: "js-early-exit",
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Add an early `return` / `continue` to flatten deep nesting and short-circuit when the predicate is already known",
  examples: [
    {
      before:
        "if (user) {\n  if (user.isActive) {\n    if (user.canEdit) {\n      save(user);\n    }\n  }\n}",
      after:
        "if (!user) return;\nif (!user.isActive) return;\nif (!user.canEdit) return;\nsave(user);",
    },
  ],
  create: (context: RuleContext) => ({
    IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
      if (!isNodeOfType(node.consequent, "BlockStatement") || !node.consequent.body) return;

      let nestingDepth = 0;
      let currentBlock: EsTreeNode = node.consequent;
      while (isNodeOfType(currentBlock, "BlockStatement") && currentBlock.body?.length === 1) {
        const innerStatement: EsTreeNode = currentBlock.body[0];
        if (!isNodeOfType(innerStatement, "IfStatement")) break;
        nestingDepth++;
        currentBlock = innerStatement.consequent;
      }

      if (nestingDepth >= DEEP_NESTING_THRESHOLD) {
        context.report({
          node,
          message: `${nestingDepth + 1} levels of nested if statements — use early returns to flatten`,
        });
      }
    },
  }),
});
