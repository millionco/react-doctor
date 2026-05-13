import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkServerFnChain } from "./utils/walk-server-fn-chain.js";

export const tanstackStartServerFnValidateInput = defineRule<Rule>({
  recommendation:
    "Add `.inputValidator(schema)` before `.handler()` — data crosses a network boundary and must be validated at runtime",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier") return;
      if (node.callee.property.name !== "handler") return;

      const chainInfo = walkServerFnChain(node);
      if (!chainInfo.isServerFnChain) return;

      const handlerFunction = node.arguments?.[0];
      if (!handlerFunction) return;

      let accessesData = false;
      walkAst(handlerFunction, (child: EsTreeNode) => {
        if (
          child.type === "MemberExpression" &&
          child.property?.type === "Identifier" &&
          child.property.name === "data"
        ) {
          accessesData = true;
        }
        if (
          child.type === "ObjectPattern" &&
          child.properties?.some(
            (property: EsTreeNode) =>
              property.key?.type === "Identifier" && property.key.name === "data",
          )
        ) {
          accessesData = true;
        }
      });

      if (accessesData && !chainInfo.hasInputValidator) {
        context.report({
          node,
          message:
            "Server function handler accesses data without inputValidator() — validate inputs crossing the network boundary",
        });
      }
    },
  }),
});
