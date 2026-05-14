import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryNoRestDestructuring = defineRule<Rule>({
  id: "query-no-rest-destructuring",
  requires: ["tanstack-query"],
  framework: "tanstack-query",
  severity: "warn",
  category: "TanStack Query",
  recommendation:
    "Destructure only the fields you need: `const { data, isLoading } = useQuery(...)` — rest destructuring subscribes to all fields and causes extra re-renders",
  examples: [
    {
      before: "const { data, ...rest } = useQuery({ queryKey: ['user'], queryFn });",
      after: "const { data, isLoading } = useQuery({ queryKey: ['user'], queryFn });",
    },
  ],
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "ObjectPattern")) return;
      if (!node.init || !isNodeOfType(node.init, "CallExpression")) return;

      const calleeName = isNodeOfType(node.init.callee, "Identifier")
        ? node.init.callee.name
        : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const hasRestElement = node.id.properties?.some((property: EsTreeNode) =>
        isNodeOfType(property, "RestElement"),
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
