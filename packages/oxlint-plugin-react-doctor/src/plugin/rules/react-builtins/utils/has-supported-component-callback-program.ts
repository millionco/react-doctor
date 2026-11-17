import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const hasSupportedComponentCallbackProgram = (program: EsTreeNode): boolean => {
  let isSupported = true;
  walkAst(program, (node) => {
    if (!isSupported) return false;
    if (
      node.type === "TSInterfaceDeclaration" ||
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSTypeAnnotation"
    ) {
      return false;
    }
    if (
      node.type.startsWith("TS") ||
      node.type === "Decorator" ||
      node.type === "WithStatement" ||
      (isNodeOfType(node, "Identifier") && node.name === "eval")
    ) {
      isSupported = false;
      return false;
    }
  });
  return isSupported;
};
