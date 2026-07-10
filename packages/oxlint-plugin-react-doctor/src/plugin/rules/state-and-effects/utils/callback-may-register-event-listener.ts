import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

export const callbackMayRegisterEventListener = (callbackNode: EsTreeNode): boolean => {
  let foundCall = false;
  walkAst(callbackNode, (child) => {
    if (isNodeOfType(child, "CallExpression")) {
      foundCall = true;
      return false;
    }
  });
  return foundCall;
};
