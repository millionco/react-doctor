import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const jsBatchDomCss = defineRule<Rule>({
  recommendation:
    "Batch DOM/CSS reads and writes — interleaving them inside a loop causes layout thrashing. Read first, then write",
  create: (context: RuleContext) => {
    const isStyleAssignment = (node: EsTreeNode): boolean =>
      node.type === "ExpressionStatement" &&
      node.expression?.type === "AssignmentExpression" &&
      node.expression.left?.type === "MemberExpression" &&
      node.expression.left.object?.type === "MemberExpression" &&
      node.expression.left.object.property?.type === "Identifier" &&
      node.expression.left.object.property.name === "style";

    return {
      BlockStatement(node: EsTreeNode) {
        const statements = node.body ?? [];
        for (let statementIndex = 1; statementIndex < statements.length; statementIndex++) {
          if (
            isStyleAssignment(statements[statementIndex]) &&
            isStyleAssignment(statements[statementIndex - 1])
          ) {
            context.report({
              node: statements[statementIndex],
              message:
                "Multiple sequential element.style assignments — batch with cssText or classList for fewer reflows",
            });
          }
        }
      },
    };
  },
});
