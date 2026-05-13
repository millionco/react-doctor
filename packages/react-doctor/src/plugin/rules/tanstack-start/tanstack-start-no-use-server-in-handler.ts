import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const tanstackStartNoUseServerInHandler = defineRule<Rule>({
  recommendation:
    'TanStack Start handles server boundaries automatically via the Vite plugin — "use server" inside createServerFn causes compilation errors',
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier" || node.callee.property.name !== "handler")
        return;

      const handlerFunction = node.arguments?.[0];
      if (
        !handlerFunction ||
        (handlerFunction.type !== "ArrowFunctionExpression" &&
          handlerFunction.type !== "FunctionExpression")
      )
        return;

      const body = handlerFunction.body;
      if (body?.type !== "BlockStatement") return;

      const hasUseServerDirective = body.body?.some(
        (statement: EsTreeNode) =>
          statement.type === "ExpressionStatement" &&
          (statement.directive === "use server" ||
            (statement.expression?.type === "Literal" &&
              statement.expression.value === "use server")),
      );

      if (hasUseServerDirective) {
        context.report({
          node: handlerFunction,
          message:
            '"use server" inside createServerFn handler — TanStack Start handles this automatically, remove the directive',
        });
      }
    },
  }),
});
