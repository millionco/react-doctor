import { MUTATING_HTTP_METHODS, TANSTACK_QUERY_HOOKS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const queryNoUseQueryForMutation = defineRule<Rule>({
  recommendation:
    "Use `useMutation()` for POST/PUT/DELETE — it provides onSuccess/onError callbacks, doesn't auto-refetch, and correctly models write operations",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const calleeName = node.callee?.type === "Identifier" ? node.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return;

      const queryFnProperty = optionsArgument.properties?.find(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "queryFn",
      );

      if (!queryFnProperty?.value) return;

      let hasMutatingFetch = false;
      walkAst(queryFnProperty.value, (child: EsTreeNode) => {
        if (hasMutatingFetch) return;
        if (child.type !== "CallExpression") return;
        if (child.callee?.type !== "Identifier" || child.callee.name !== "fetch") return;

        const optionsArg = child.arguments?.[1];
        if (!optionsArg || optionsArg.type !== "ObjectExpression") return;

        const methodProperty = optionsArg.properties?.find(
          (property: EsTreeNode) =>
            property.type === "Property" &&
            property.key?.type === "Identifier" &&
            property.key.name === "method" &&
            property.value?.type === "Literal" &&
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
