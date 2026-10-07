import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface MutationReceiverKinds extends ReadonlyMap<string, "object" | "reflect"> {}

export const collectMutationReceiverKinds = (rootNode: EsTreeNode): MutationReceiverKinds => {
  const receiverKinds = new Map<string, "object" | "reflect">([
    ["Object", "object"],
    ["Reflect", "reflect"],
  ]);
  let didAddReceiver = true;
  while (didAddReceiver) {
    didAddReceiver = false;
    walkAst(rootNode, (node) => {
      if (
        !isNodeOfType(node, "VariableDeclarator") ||
        !isNodeOfType(node.id, "Identifier") ||
        !node.init
      ) {
        return;
      }
      const initializer = stripParenExpression(node.init);
      if (!isNodeOfType(initializer, "Identifier")) return;
      const receiverKind = receiverKinds.get(initializer.name);
      if (!receiverKind || receiverKinds.has(node.id.name)) return;
      receiverKinds.set(node.id.name, receiverKind);
      didAddReceiver = true;
    });
  }
  return receiverKinds;
};
