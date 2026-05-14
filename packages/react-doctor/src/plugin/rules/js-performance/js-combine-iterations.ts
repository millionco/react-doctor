import { CHAINABLE_ITERATION_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsCombineIterations = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Combine `.map().filter()` (or similar chains) into a single pass with `.reduce()` or a `for...of` loop to avoid iterating the array twice",
  examples: [
    {
      before: "users.map((u) => u.name).filter((name) => name.startsWith('A'));",
      after:
        "users.reduce((acc, u) => { if (u.name.startsWith('A')) acc.push(u.name); return acc; }, []);",
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
      if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

      const innerCall = node.callee.object;
      if (
        !isNodeOfType(innerCall, "CallExpression") ||
        !isNodeOfType(innerCall.callee, "MemberExpression") ||
        !isNodeOfType(innerCall.callee.property, "Identifier")
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;

      if (innerMethod === "map" && outerMethod === "filter") {
        const filterArgument = node.arguments?.[0];
        const isBooleanOrIdentityFilter =
          (isNodeOfType(filterArgument, "Identifier") && filterArgument.name === "Boolean") ||
          (isNodeOfType(filterArgument, "ArrowFunctionExpression") &&
            filterArgument.params?.length === 1 &&
            isNodeOfType(filterArgument.body, "Identifier") &&
            isNodeOfType(filterArgument.params[0], "Identifier") &&
            filterArgument.body.name === filterArgument.params[0].name);
        if (isBooleanOrIdentityFilter) return;
      }

      context.report({
        node,
        message: `.${innerMethod}().${outerMethod}() iterates the array twice — combine into a single loop with .reduce() or for...of`,
      });
    },
  }),
});
