import { CHAINABLE_ITERATION_METHODS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const jsCombineIterations = defineRule<Rule>({
  recommendation:
    "Combine `.map().filter()` (or similar chains) into a single pass with `.reduce()` or a `for...of` loop to avoid iterating the array twice",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
        return;

      const outerMethod = node.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

      const innerCall = node.callee.object;
      if (
        innerCall?.type !== "CallExpression" ||
        innerCall.callee?.type !== "MemberExpression" ||
        innerCall.callee.property?.type !== "Identifier"
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;

      if (innerMethod === "map" && outerMethod === "filter") {
        const filterArgument = node.arguments?.[0];
        const isBooleanOrIdentityFilter =
          (filterArgument?.type === "Identifier" && filterArgument.name === "Boolean") ||
          (filterArgument?.type === "ArrowFunctionExpression" &&
            filterArgument.params?.length === 1 &&
            filterArgument.body?.type === "Identifier" &&
            filterArgument.params[0]?.type === "Identifier" &&
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
