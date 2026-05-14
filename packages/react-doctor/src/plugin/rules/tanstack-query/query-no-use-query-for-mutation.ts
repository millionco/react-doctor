import { MUTATING_HTTP_METHODS, TANSTACK_QUERY_HOOKS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryNoUseQueryForMutation = defineRule<Rule>({
  requires: ["tanstack-query"],
  framework: "tanstack-query",
  severity: "warn",
  category: "TanStack Query",
  recommendation:
    "Use `useMutation()` for POST/PUT/DELETE — it provides onSuccess/onError callbacks, doesn't auto-refetch, and correctly models write operations",
  examples: [
    {
      before:
        "useQuery({ queryKey: ['delete', id], queryFn: () => fetch(`/api/users/${id}`, { method: 'DELETE' }) });",
      after:
        "const mutation = useMutation({ mutationFn: (id) => fetch(`/api/users/${id}`, { method: 'DELETE' }) });",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return;

      const queryFnProperty = optionsArgument.properties?.find(
        (property: EsTreeNode) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "queryFn",
      );

      if (!queryFnProperty || !isNodeOfType(queryFnProperty, "Property") || !queryFnProperty.value)
        return;

      let hasMutatingFetch = false;
      walkAst(queryFnProperty.value, (child: EsTreeNode) => {
        if (hasMutatingFetch) return;
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isNodeOfType(child.callee, "Identifier") || child.callee.name !== "fetch") return;

        const optionsArg = child.arguments?.[1];
        if (!optionsArg || !isNodeOfType(optionsArg, "ObjectExpression")) return;

        const methodProperty = optionsArg.properties?.find(
          (property: EsTreeNode) =>
            isNodeOfType(property, "Property") &&
            isNodeOfType(property.key, "Identifier") &&
            property.key.name === "method" &&
            isNodeOfType(property.value, "Literal") &&
            typeof property.value.value === "string" &&
            MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase()),
        );

        if (methodProperty) hasMutatingFetch = true;
      });

      if (hasMutatingFetch) {
        context.report({
          node,
          message: `${calleeName}() with a mutating fetch (POST/PUT/DELETE) — use useMutation() instead, which provides onSuccess/onError callbacks and doesn't auto-refetch`,
        });
      }
    },
  }),
});
