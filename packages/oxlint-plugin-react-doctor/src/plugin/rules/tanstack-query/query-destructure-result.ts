import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryDestructureResult = defineRule<Rule>({
  id: "query-destructure-result",
  title: "Whole query result subscribes to every field",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "error",
  recommendation:
    "Destructure only the fields you need, like `const { data, isLoading } = useQuery(...)`. Assigning the whole object bypasses TanStack Query's tracked-property optimization and subscribes to every field.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier")) return;
      if (!node.init || !isNodeOfType(node.init, "CallExpression")) return;

      const calleeName = isNodeOfType(node.init.callee, "Identifier")
        ? node.init.callee.name
        : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      context.report({
        node: node.id,
        message: `Destructure ${calleeName}() results instead of assigning the whole query object, so TanStack Query only subscribes to the fields you use.`,
      });
    },
  }),
});
