import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryNoVoidQueryFn = defineRule<Rule>({
  id: "query-no-void-query-fn",
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "queryFn must return a value for the cache. Use the `enabled` option to conditionally disable the query instead of returning undefined",
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

      const queryFnValue = queryFnProperty.value;

      if (
        isNodeOfType(queryFnValue, "ArrowFunctionExpression") &&
        !isNodeOfType(queryFnValue.body, "BlockStatement")
      ) {
        return;
      }

      if (
        isNodeOfType(queryFnValue, "ArrowFunctionExpression") ||
        isNodeOfType(queryFnValue, "FunctionExpression")
      ) {
        const body = queryFnValue.body;
        if (!isNodeOfType(body, "BlockStatement")) return;

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
