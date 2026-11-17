import type { EsTreeNode } from "./es-tree-node.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { isEverySpecifierInlineType } from "./is-type-only-import.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasExplicitRuntimeModuleSyntax = (program: EsTreeNode): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  return program.body.some((statement) => {
    if (getRuntimeStaticDependencySource(statement) !== null) return true;
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      const declaration = statement.declaration;
      return (
        !("declare" in declaration && declaration.declare) &&
        !["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSDeclareFunction"].includes(
          declaration.type,
        )
      );
    }
    if (
      !isNodeOfType(statement, "ExportNamedDeclaration") ||
      statement.exportKind === "type" ||
      statement.source
    )
      return false;
    const declaration = statement.declaration;
    if (!declaration)
      return !isEverySpecifierInlineType(statement.specifiers, "ExportSpecifier", "exportKind");
    return (
      !("declare" in declaration && declaration.declare) &&
      (isNodeOfType(declaration, "VariableDeclaration") ||
        isNodeOfType(declaration, "FunctionDeclaration") ||
        isNodeOfType(declaration, "ClassDeclaration"))
    );
  });
};
