import { RENDER_FUNCTION_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noRenderInRender = defineRule<Rule>({
  recommendation:
    "Extract to a named component: `const ListItem = ({ item }) => <div>{item.name}</div>`",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNode) {
      const expression = node.expression;
      if (expression?.type !== "CallExpression") return;

      let calleeName: string | null = null;
      if (expression.callee?.type === "Identifier") {
        calleeName = expression.callee.name;
      } else if (
        expression.callee?.type === "MemberExpression" &&
        expression.callee.property?.type === "Identifier"
      ) {
        calleeName = expression.callee.property.name;
      }

      if (calleeName && RENDER_FUNCTION_PATTERN.test(calleeName)) {
        context.report({
          node: expression,
          message: `Inline render function "${calleeName}()" — extract to a separate component for proper reconciliation`,
        });
      }
    },
  }),
});
