import { MUTATING_HTTP_METHODS } from "../../constants/library.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSideEffect } from "../../utils/find-side-effect.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkServerFnChain } from "./utils/walk-server-fn-chain.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartGetMutation = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "warn",
  category: "Security",
  recommendation:
    "Use `createServerFn({ method: 'POST' })` for data modifications — GET requests can be triggered by prefetching and are vulnerable to CSRF",
  examples: [
    {
      before:
        "const deleteUser = createServerFn({ method: 'GET' }).handler(async ({ data }) => db.user.delete({ where: { id: data.id } }));",
      after:
        "const deleteUser = createServerFn({ method: 'POST' }).handler(async ({ data }) => db.user.delete({ where: { id: data.id } }));",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (
        !isNodeOfType(node.callee.property, "Identifier") ||
        node.callee.property.name !== "handler"
      )
        return;

      const chainInfo = walkServerFnChain(node);
      if (!chainInfo.isServerFnChain) return;
      if (
        chainInfo.specifiedMethod &&
        MUTATING_HTTP_METHODS.has(chainInfo.specifiedMethod.toUpperCase())
      )
        return;

      const handlerFunction = node.arguments?.[0];
      if (!handlerFunction) return;

      const sideEffect = findSideEffect(handlerFunction);
      if (sideEffect) {
        context.report({
          node,
          message: `GET server function has side effects (${sideEffect}) — use createServerFn({ method: 'POST' }) for mutations`,
        });
      }
    },
  }),
});
