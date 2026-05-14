import { DEEP_NESTING_THRESHOLD } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const jsEarlyExit = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Add an early `return` / `continue` to flatten deep nesting and short-circuit when the predicate is already known",
  create: (context: RuleContext) => ({
    IfStatement(node: EsTreeNode) {
      if (!isNodeOfType(node.consequent, "BlockStatement") || !node.consequent.body) return;

      let nestingDepth = 0;
      let currentBlock: EsTreeNode = node.consequent;
      while (isNodeOfType(currentBlock, "BlockStatement") && currentBlock.body?.length === 1) {
        const innerStatement = currentBlock.body[0];
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
