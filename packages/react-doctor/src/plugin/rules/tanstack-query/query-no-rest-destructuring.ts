import { TANSTACK_QUERY_HOOKS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const queryNoRestDestructuring = defineRule<Rule>({
  recommendation:
    "Destructure only the fields you need: `const { data, isLoading } = useQuery(...)` — rest destructuring subscribes to all fields and causes extra re-renders",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNode) {
      if (node.id?.type !== "ObjectPattern") return;
      if (!node.init || node.init.type !== "CallExpression") return;

      const calleeName = node.init.callee?.type === "Identifier" ? node.init.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const hasRestElement = node.id.properties?.some(
        (property: EsTreeNode) => property.type === "RestElement",
      );

      if (hasRestElement) {
        context.report({
          node: node.id,
          message: `Rest destructuring on ${calleeName}() result — subscribes to all fields and causes unnecessary re-renders. Destructure only the fields you need`,
        });
      }
    },
  }),
});
