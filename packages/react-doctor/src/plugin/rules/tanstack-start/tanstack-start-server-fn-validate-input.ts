import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkServerFnChain } from "./utils/walk-server-fn-chain.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const tanstackStartServerFnValidateInput = defineRule<Rule>({
  framework: "tanstack-start",
  severity: "warn",
  category: "TanStack Start",
  recommendation:
    "Add `.inputValidator(schema)` before `.handler()` — data crosses a network boundary and must be validated at runtime",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "handler") return;

      const chainInfo = walkServerFnChain(node);
      if (!chainInfo.isServerFnChain) return;

      const handlerFunction = node.arguments?.[0];
      if (!handlerFunction) return;

      let accessesData = false;
      walkAst(handlerFunction, (child: EsTreeNode) => {
        if (
          isNodeOfType(child, "MemberExpression") &&
          isNodeOfType(child.property, "Identifier") &&
          child.property.name === "data"
        ) {
          accessesData = true;
        }
        if (
          isNodeOfType(child, "ObjectPattern") &&
          child.properties?.some(
            (property: EsTreeNode) =>
              isNodeOfType(property.key, "Identifier") && property.key.name === "data",
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
