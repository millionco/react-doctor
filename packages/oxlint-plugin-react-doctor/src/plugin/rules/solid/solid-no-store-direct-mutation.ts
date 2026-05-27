import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const STORE_SOURCE_PATTERN = /^solid-js\/store$/;

const STORE_CREATORS: ReadonlyArray<string> = ["createStore"];

const getRootObject = (node: EsTreeNode): EsTreeNode => {
  if (isNodeOfType(node, "MemberExpression")) {
    return getRootObject(node.object as EsTreeNode);
  }
  return node;
};

export const solidNoStoreDirectMutation = defineRule<Rule>({
  id: "solid-no-store-direct-mutation",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Store proxies are read-only — direct property assignment won't trigger reactivity. Use `setStore()` or `produce()` instead.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker(STORE_SOURCE_PATTERN);
    const storeProxyNames = new Set<string>();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;
        if (!importTracker.matchImport(STORE_CREATORS, node.init.callee.name)) return;
        if (!isNodeOfType(node.id, "ArrayPattern")) return;
        const firstElement = node.id.elements[0];
        if (firstElement && isNodeOfType(firstElement, "Identifier")) {
          storeProxyNames.add(firstElement.name);
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (!isNodeOfType(node.left, "MemberExpression")) return;
        const rootObject = getRootObject(node.left as EsTreeNode);
        if (!isNodeOfType(rootObject, "Identifier")) return;
        if (!storeProxyNames.has(rootObject.name)) return;
        context.report({
          node,
          message: `Direct assignment to \`${rootObject.name}\` store property won't trigger reactivity. Use the setter function or \`produce()\` instead.`,
        });
      },
      UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
        if (!isNodeOfType(node.argument, "MemberExpression")) return;
        const rootObject = getRootObject(node.argument as EsTreeNode);
        if (!isNodeOfType(rootObject, "Identifier")) return;
        if (!storeProxyNames.has(rootObject.name)) return;
        context.report({
          node,
          message: `Direct mutation of \`${rootObject.name}\` store property won't trigger reactivity. Use the setter function or \`produce()\` instead.`,
        });
      },
      UnaryExpression(node: EsTreeNodeOfType<"UnaryExpression">) {
        if (node.operator !== "delete") return;
        if (!isNodeOfType(node.argument, "MemberExpression")) return;
        const rootObject = getRootObject(node.argument as EsTreeNode);
        if (!isNodeOfType(rootObject, "Identifier")) return;
        if (!storeProxyNames.has(rootObject.name)) return;
        context.report({
          node,
          message: `\`delete\` on \`${rootObject.name}\` store property won't trigger reactivity. Use the setter function with \`undefined\` or \`produce()\` instead.`,
        });
      },
    };
  },
});
