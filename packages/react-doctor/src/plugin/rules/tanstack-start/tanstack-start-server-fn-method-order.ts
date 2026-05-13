import { TANSTACK_MIDDLEWARE_METHOD_ORDER, TANSTACK_SERVER_FN_NAMES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const tanstackStartServerFnMethodOrder = defineRule<Rule>({
  recommendation:
    "Chain methods in order: .middleware() → .inputValidator() → .client() → .server() → .handler() — types depend on this sequence",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;

      const methodNames: string[] = [];
      let currentNode: EsTreeNode = node;

      while (
        currentNode?.type === "CallExpression" &&
        currentNode.callee?.type === "MemberExpression"
      ) {
        const methodName =
          currentNode.callee.property?.type === "Identifier"
            ? currentNode.callee.property.name
            : null;
        if (methodName) methodNames.unshift(methodName);
        currentNode = currentNode.callee.object;
      }

      if (currentNode?.type === "CallExpression" && currentNode.callee?.type === "Identifier") {
        if (!TANSTACK_SERVER_FN_NAMES.has(currentNode.callee.name)) return;
      } else {
        return;
      }

      const ownMethodName =
        node.callee.property?.type === "Identifier" ? node.callee.property.name : null;
      if (methodNames[methodNames.length - 1] !== ownMethodName) return;

      const orderSensitiveMethods = methodNames.filter((name) =>
        TANSTACK_MIDDLEWARE_METHOD_ORDER.includes(name),
      );

      let lastIndex = -1;
      for (const methodName of orderSensitiveMethods) {
        const currentIndex = TANSTACK_MIDDLEWARE_METHOD_ORDER.indexOf(methodName);
        if (currentIndex < lastIndex) {
          const expectedBefore = TANSTACK_MIDDLEWARE_METHOD_ORDER[lastIndex];
          context.report({
            node,
            message: `Server function method .${methodName}() must come before .${expectedBefore}() — wrong order breaks type inference`,
          });
          return;
        }
        lastIndex = currentIndex;
      }
    },
  }),
});
