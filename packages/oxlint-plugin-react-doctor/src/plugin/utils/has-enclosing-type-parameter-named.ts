import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasEnclosingTypeParameterNamed = (
  node: EsTreeNode,
  typeParameterName: string,
): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if ("typeParameters" in ancestor) {
      const typeParameters = ancestor.typeParameters;
      if (
        typeParameters &&
        isNodeOfType(typeParameters, "TSTypeParameterDeclaration") &&
        typeParameters.params.some(
          (typeParameter) =>
            isNodeOfType(typeParameter, "TSTypeParameter") &&
            isNodeOfType(typeParameter.name, "Identifier") &&
            typeParameter.name.name === typeParameterName,
        )
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};
