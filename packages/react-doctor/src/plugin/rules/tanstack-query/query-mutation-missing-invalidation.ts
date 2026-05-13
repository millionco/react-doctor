import { QUERY_CACHE_UPDATE_METHODS, TANSTACK_MUTATION_HOOKS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const queryMutationMissingInvalidation = defineRule<Rule>({
  recommendation:
    "Add `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['...'] })` so cached data stays in sync after the mutation",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const calleeName = node.callee?.type === "Identifier" ? node.callee.name : null;

      if (!calleeName || !TANSTACK_MUTATION_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return;

      const hasMutationFn = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "mutationFn",
      );

      if (!hasMutationFn) return;

      let hasCacheUpdate = false;
      walkAst(optionsArgument, (child: EsTreeNode) => {
        if (hasCacheUpdate) return false;
        if (
          child.type === "CallExpression" &&
          child.callee?.type === "MemberExpression" &&
          child.callee.property?.type === "Identifier" &&
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
