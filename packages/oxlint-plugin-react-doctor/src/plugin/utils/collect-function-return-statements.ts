import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

export const collectFunctionReturnStatements = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"ReturnStatement">[] => {
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement"))
    return [];
  const returnStatements: EsTreeNodeOfType<"ReturnStatement">[] = [];
  walkAst(functionNode.body, (node) => {
    if (
      node !== functionNode.body &&
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (isNodeOfType(node, "ReturnStatement")) returnStatements.push(node);
  });
  return returnStatements;
};
