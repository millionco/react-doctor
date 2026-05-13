import { TANSTACK_QUERY_HOOKS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const queryNoVoidQueryFn = defineRule<Rule>({
  recommendation:
    "queryFn must return a value for the cache. Use the `enabled` option to conditionally disable the query instead of returning undefined",
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

      const queryFnValue = queryFnProperty.value;

      if (
        queryFnValue.type === "ArrowFunctionExpression" &&
        queryFnValue.body?.type !== "BlockStatement"
      ) {
        return;
      }

      if (
        queryFnValue.type === "ArrowFunctionExpression" ||
        queryFnValue.type === "FunctionExpression"
      ) {
        const body = queryFnValue.body;
        if (body?.type !== "BlockStatement") return;

        const statements = body.body ?? [];
        if (statements.length === 0) {
          context.report({
            node: queryFnProperty,
            message:
              "Empty queryFn — query functions must return a value. Use the enabled option to conditionally disable the query instead",
          });
        }
      }
    },
  }),
});
