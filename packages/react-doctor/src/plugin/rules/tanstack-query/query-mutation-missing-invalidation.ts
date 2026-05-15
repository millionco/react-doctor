import { QUERY_CACHE_UPDATE_METHODS, TANSTACK_MUTATION_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryMutationMissingInvalidation = defineRule<Rule>({
  id: "query-mutation-missing-invalidation",
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Add `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['...'] })` so cached data stays in sync after the mutation",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;

      if (!calleeName || !TANSTACK_MUTATION_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return;

      const hasMutationFn = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "mutationFn",
      );

      if (!hasMutationFn) return;

      let hasCacheUpdate = false;
      walkAst(optionsArgument, (child: EsTreeNode) => {
        if (hasCacheUpdate) return false;
        if (
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "MemberExpression") &&
          isNodeOfType(child.callee.property, "Identifier") &&
          QUERY_CACHE_UPDATE_METHODS.has(child.callee.property.name)
        ) {
          hasCacheUpdate = true;
          return false;
        }
      });

      if (!hasCacheUpdate) {
        context.report({
          node,
          message:
            "useMutation without a cache update — stale data may remain after the mutation. Call queryClient.invalidateQueries / setQueryData / resetQueries / refetchQueries inside onSuccess (or trigger a router refresh)",
        });
      }
    },
  }),
});
