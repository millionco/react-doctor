import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

const declarationsByProgram = new WeakMap<EsTreeNode, ReadonlyMap<string, EsTreeNode | null>>();

const collectDeclarations = (program: EsTreeNode): ReadonlyMap<string, EsTreeNode | null> => {
  const declarations = new Map<string, EsTreeNode | null>();
  if (!isNodeOfType(program, "Program")) return declarations;
  for (const statement of program.body) {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (
      !declaration ||
      (!isNodeOfType(declaration, "TSInterfaceDeclaration") &&
        !isNodeOfType(declaration, "TSTypeAliasDeclaration"))
    ) {
      continue;
    }
    const name = declaration.id.name;
    declarations.set(name, declarations.has(name) ? null : declaration);
  }
  return declarations;
};

export const findSameFileTypeDeclaration = (
  referenceNode: EsTreeNode,
  typeName: string,
): EsTreeNode | null => {
  const program = findProgramRoot(referenceNode);
  if (!program) return null;
  let declarations = declarationsByProgram.get(program);
  if (!declarations) {
    declarations = collectDeclarations(program);
    declarationsByProgram.set(program, declarations);
  }
  return declarations.get(typeName) ?? null;
};
