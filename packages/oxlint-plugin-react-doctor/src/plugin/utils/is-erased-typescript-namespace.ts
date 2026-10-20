import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const erasedNamespaces = new WeakMap<EsTreeNode, boolean>();

export const isErasedTypeScriptNamespace = (node: EsTreeNode): boolean => {
  const cached = erasedNamespaces.get(node);
  if (cached !== undefined) return cached;
  let isErased = false;
  if (isNodeOfType(node, "TSInterfaceDeclaration") || isNodeOfType(node, "TSTypeAliasDeclaration"))
    isErased = true;
  else if (isNodeOfType(node, "TSImportEqualsDeclaration"))
    isErased =
      node.importKind === "type" ||
      !isNodeOfType(node.moduleReference, "TSExternalModuleReference");
  else if (isNodeOfType(node, "ExportNamedDeclaration"))
    isErased = isNodeOfType(node.declaration, "TSImportEqualsDeclaration")
      ? node.declaration.importKind === "type"
      : Boolean(node.declaration && isErasedTypeScriptNamespace(node.declaration));
  else if (isNodeOfType(node, "TSModuleDeclaration") && node.body)
    isErased = isNodeOfType(node.body, "TSModuleDeclaration")
      ? isErasedTypeScriptNamespace(node.body)
      : isNodeOfType(node.body, "TSModuleBlock") &&
        node.body.body.every(isErasedTypeScriptNamespace);
  erasedNamespaces.set(node, isErased);
  return isErased;
};
