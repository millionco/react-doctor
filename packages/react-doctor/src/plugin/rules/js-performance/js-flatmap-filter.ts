import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsFlatmapFilter = defineRule<Rule>({
  id: "js-flatmap-filter",
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `.flatMap(item => condition ? [value] : [])` — transforms and filters in a single pass instead of creating an intermediate array",
  examples: [
    {
      before: "items.map((item) => item.value).filter(Boolean);",
      after: "items.flatMap((item) => (item.value ? [item.value] : []));",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !isNodeOfType(node.callee.property, "Identifier")
      )
        return;

      const outerMethod = node.callee.property.name;
      if (outerMethod !== "filter") return;

      const filterArgument = node.arguments?.[0];
      if (!filterArgument) return;

      const isIdentityArrow =
        isNodeOfType(filterArgument, "ArrowFunctionExpression") &&
        filterArgument.params?.length === 1 &&
        isNodeOfType(filterArgument.body, "Identifier") &&
        isNodeOfType(filterArgument.params[0], "Identifier") &&
        filterArgument.body.name === filterArgument.params[0].name;

      const isFilterBoolean =
        (isNodeOfType(filterArgument, "Identifier") && filterArgument.name === "Boolean") ||
        isIdentityArrow;

      if (!isFilterBoolean) return;

      const innerCall = node.callee.object;
      if (
        !isNodeOfType(innerCall, "CallExpression") ||
        !isNodeOfType(innerCall.callee, "MemberExpression") ||
        !isNodeOfType(innerCall.callee.property, "Identifier")
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (innerMethod !== "map") return;

      context.report({
        node,
        message:
          ".map().filter(Boolean) iterates twice — use .flatMap() to transform and filter in a single pass",
      });
    },
  }),
});
