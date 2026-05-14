import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoUseServerInHandler = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "error",
  category: "TanStack Start",
  recommendation:
    'TanStack Start handles server boundaries automatically via the Vite plugin — "use server" inside createServerFn causes compilation errors',
  examples: [
    {
      before:
        "createServerFn().handler(async () => {\n  'use server';\n  return db.user.findMany();\n});",
      after: "createServerFn().handler(async () => db.user.findMany());",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (
        !isNodeOfType(node.callee.property, "Identifier") ||
        node.callee.property.name !== "handler"
      )
        return;

      const handlerFunction = node.arguments?.[0];
      if (
        !handlerFunction ||
        (!isNodeOfType(handlerFunction, "ArrowFunctionExpression") &&
          !isNodeOfType(handlerFunction, "FunctionExpression"))
      )
        return;

      const body = handlerFunction.body;
      if (!isNodeOfType(body, "BlockStatement")) return;

      const hasUseServerDirective = body.body?.some(
        (statement: EsTreeNode) =>
          isNodeOfType(statement, "ExpressionStatement") &&
          (statement.directive === "use server" ||
            (isNodeOfType(statement.expression, "Literal") &&
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
