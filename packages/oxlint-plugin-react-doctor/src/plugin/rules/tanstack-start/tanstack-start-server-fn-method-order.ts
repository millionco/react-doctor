import {
  TANSTACK_INPUT_VALIDATOR_METHOD_NAMES,
  TANSTACK_MIDDLEWARE_METHOD_ORDER,
  TANSTACK_SERVER_FN_NAMES,
} from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const toMethodOrderToken = (methodName: string): string =>
  TANSTACK_INPUT_VALIDATOR_METHOD_NAMES.has(methodName) ? "validator" : methodName;

export const tanstackStartServerFnMethodOrder = defineRule({
  id: "tanstack-start-server-fn-method-order",
  title: "Server function method order breaks type inference",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "error",
  recommendation:
    "Chain methods in order: .middleware() → .validator() → .client() → .server() → .handler(). Types depend on this sequence.",
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
        TANSTACK_MIDDLEWARE_METHOD_ORDER.includes(toMethodOrderToken(name)),
      );

      let lastIndex = -1;
      for (const methodName of orderSensitiveMethods) {
        const currentIndex = TANSTACK_MIDDLEWARE_METHOD_ORDER.indexOf(
          toMethodOrderToken(methodName),
        );
        if (currentIndex < lastIndex) {
          const expectedBefore = TANSTACK_MIDDLEWARE_METHOD_ORDER[lastIndex];
          context.report({
            node,
            message: `Chaining .${methodName}() after .${expectedBefore}() breaks type inference.`,
          });
          return;
        }
        lastIndex = currentIndex;
      }
    },
  }),
});
