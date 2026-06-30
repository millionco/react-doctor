import { QUERY_CACHE_UPDATE_METHODS, TANSTACK_MUTATION_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryMutationMissingInvalidation = defineRule({
  id: "query-mutation-missing-invalidation",
  title: "Mutation without cache invalidation",
  tags: ["test-noise"],
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
        if (!isNodeOfType(child, "CallExpression")) return;
        // `queryClient.invalidateQueries(...)` — member-call form.
        if (
          isNodeOfType(child.callee, "MemberExpression") &&
          isNodeOfType(child.callee.property, "Identifier") &&
          QUERY_CACHE_UPDATE_METHODS.has(child.callee.property.name)
        ) {
          hasCacheUpdate = true;
          return false;
        }
        // `const { invalidateQueries } = useQueryClient()` then a bare
        // `invalidateQueries(...)` — destructured-callee form.
        if (
          isNodeOfType(child.callee, "Identifier") &&
          QUERY_CACHE_UPDATE_METHODS.has(child.callee.name)
        ) {
          hasCacheUpdate = true;
          return false;
        }
      });

      if (!hasCacheUpdate) {
        context.report({
          node,
          message:
            "useMutation with no cache update leaves your users looking at stale data after it runs.",
        });
      }
    },
  }),
});
