import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getRuntimeStaticDependencySource = (statement: EsTreeNode): string | null => {
  if (isNodeOfType(statement, "ImportDeclaration")) {
    if (
      statement.importKind === "type" ||
      (statement.specifiers.length > 0 &&
        statement.specifiers.every(
          (specifier) =>
            isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type",
        ))
    ) {
      return null;
    }
  } else if (isNodeOfType(statement, "ExportNamedDeclaration")) {
    if (
      statement.exportKind === "type" ||
      !statement.source ||
      (statement.specifiers.length > 0 &&
        statement.specifiers.every(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") && specifier.exportKind === "type",
        ))
    ) {
      return null;
    }
  } else if (isNodeOfType(statement, "ExportAllDeclaration")) {
    if (statement.exportKind === "type") return null;
  } else {
    return null;
  }
  return statement.source && typeof statement.source.value === "string"
    ? statement.source.value
    : null;
};
