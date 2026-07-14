import type { EsTreeNode } from "./es-tree-node.js";
import {
  getImportBindingForName,
  getImportedNameFromModule,
} from "./find-import-source-for-name.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

const isReactNamespaceBinding = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const binding = getImportBindingForName(node, node.name);
  return Boolean(
    binding &&
    binding.source === "react" &&
    (binding.isNamespace || binding.exportedName === "default"),
  );
};

const hasLocalJsxNamespace = (node: EsTreeNode): boolean => {
  const program = findProgramRoot(node);
  if (!program || !isNodeOfType(program, "Program")) return false;
  return program.body.some(
    (statement) =>
      isNodeOfType(statement, "TSModuleDeclaration") &&
      isNodeOfType(statement.id, "Identifier") &&
      statement.id.name === "JSX",
  );
};

const isReactElementTypeReference = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "TSTypeReference")) return false;
  const typeName = node.typeName;
  if (isNodeOfType(typeName, "Identifier")) {
    return getImportedNameFromModule(typeName, typeName.name, "react") === "ReactElement";
  }
  if (!isNodeOfType(typeName, "TSQualifiedName")) return false;
  if (!isNodeOfType(typeName.right, "Identifier")) return false;
  if (typeName.right.name === "ReactElement" && isReactNamespaceBinding(typeName.left)) {
    return true;
  }
  if (typeName.right.name !== "Element") return false;
  if (isNodeOfType(typeName.left, "Identifier")) {
    if (typeName.left.name !== "JSX") return false;
    const binding = getImportBindingForName(typeName.left, typeName.left.name);
    if (!binding) return !hasLocalJsxNamespace(typeName.left);
    return binding.source === "react" && binding.exportedName === "JSX";
  }
  return (
    isNodeOfType(typeName.left, "TSQualifiedName") &&
    isNodeOfType(typeName.left.right, "Identifier") &&
    typeName.left.right.name === "JSX" &&
    isReactNamespaceBinding(typeName.left.left)
  );
};

const containsReactElementType = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "TSUnionType")) {
    return node.types.some((member) => containsReactElementType(member));
  }
  return isReactElementTypeReference(node);
};

export const functionHasReactElementReturnType = (functionNode: EsTreeNode): boolean => {
  const returnType = Reflect.get(functionNode, "returnType");
  if (!isNodeOfType(returnType, "TSTypeAnnotation")) return false;
  return containsReactElementType(returnType.typeAnnotation);
};
