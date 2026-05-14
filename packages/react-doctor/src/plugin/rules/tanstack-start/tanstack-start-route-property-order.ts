import { TANSTACK_ROUTE_PROPERTY_ORDER } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartRoutePropertyOrder = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "error",
  category: "TanStack Start",
  recommendation:
    "Follow the order: params/validateSearch → loaderDeps → context → beforeLoad → loader → head. See https://tanstack.com/router/latest/docs/eslint/create-route-property-order",
  examples: [
    {
      before:
        "createFileRoute('/users')({\n  loader: fetchUsers,\n  beforeLoad: authCheck,\n  validateSearch: schema,\n});",
      after:
        "createFileRoute('/users')({\n  validateSearch: schema,\n  beforeLoad: authCheck,\n  loader: fetchUsers,\n});",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      const orderedPropertyNames: string[] = [];
      for (const property of properties) {
        const propertyName = getPropertyKeyName(property);
        if (propertyName !== null) {
          orderedPropertyNames.push(propertyName);
        }
      }

      const sensitiveProperties = orderedPropertyNames.filter((propertyName) =>
        TANSTACK_ROUTE_PROPERTY_ORDER.includes(propertyName),
      );

      let lastIndex = -1;
      for (const propertyName of sensitiveProperties) {
        const currentIndex = TANSTACK_ROUTE_PROPERTY_ORDER.indexOf(propertyName);
        if (currentIndex < lastIndex) {
          const expectedBefore = TANSTACK_ROUTE_PROPERTY_ORDER[lastIndex];
          context.report({
            node: optionsObject,
            message: `Route property "${propertyName}" must come before "${expectedBefore}" — wrong order breaks TypeScript type inference`,
          });
          return;
        }
        lastIndex = currentIndex;
      }
    },
  }),
});
