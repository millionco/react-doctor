import { DEEP_NESTING_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsEarlyExit = defineRule<Rule>({
  id: "js-early-exit",
  title: "Deeply nested if statements",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Add an early `return` or `continue` so the deep nesting flattens out and you bail as soon as the answer is known",
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
          message: `This is hard to follow because there are ${nestingDepth + 1} levels of nested if statements, so return early to keep it flat`,
        });
      }
    },
  }),
});
