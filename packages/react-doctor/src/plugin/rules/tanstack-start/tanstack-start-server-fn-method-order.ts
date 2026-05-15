import {
  TANSTACK_MIDDLEWARE_METHOD_ORDER,
  TANSTACK_SERVER_FN_NAMES,
} from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartServerFnMethodOrder = defineRule<Rule>({
  id: "tanstack-start-server-fn-method-order",
  requires: ["tanstack-start"],
  severity: "error",
  recommendation:
    "Chain methods in order: .middleware() → .inputValidator() → .client() → .server() → .handler() — types depend on this sequence",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;

      const methodNames: string[] = [];
      let currentNode: EsTreeNode = node;

      while (
        isNodeOfType(currentNode, "CallExpression") &&
        isNodeOfType(currentNode.callee, "MemberExpression")
      ) {
        const methodName = isNodeOfType(currentNode.callee.property, "Identifier")
          ? currentNode.callee.property.name
          : null;
        if (methodName) methodNames.unshift(methodName);
        currentNode = currentNode.callee.object;
      }

      if (
        isNodeOfType(currentNode, "CallExpression") &&
        isNodeOfType(currentNode.callee, "Identifier")
      ) {
        if (!TANSTACK_SERVER_FN_NAMES.has(currentNode.callee.name)) return;
      } else {
        return;
      }

      const ownMethodName = isNodeOfType(node.callee.property, "Identifier")
        ? node.callee.property.name
        : null;
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
