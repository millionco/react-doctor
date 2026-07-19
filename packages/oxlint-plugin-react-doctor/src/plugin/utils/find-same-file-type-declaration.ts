import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

const declarationsByProgram = new WeakMap<
  EsTreeNode,
  ReadonlyMap<string, ReadonlyArray<EsTreeNode>>
>();

const collectDeclarations = (
  program: EsTreeNode,
): ReadonlyMap<string, ReadonlyArray<EsTreeNode>> => {
  const declarations = new Map<string, ReadonlyArray<EsTreeNode>>();
  if (!isNodeOfType(program, "Program")) return declarations;
  for (const statement of program.body) {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (
      !declaration ||
      (!isNodeOfType(declaration, "TSInterfaceDeclaration") &&
        !isNodeOfType(declaration, "TSTypeAliasDeclaration")) ||
      !isNodeOfType(declaration.id, "Identifier")
    ) {
      continue;
    }
    const name = declaration.id.name;
    const matchingDeclarations = declarations.get(name) ?? [];
    declarations.set(name, [...matchingDeclarations, declaration]);
  }
  return declarations;
};

export const findSameFileTypeDeclarations = (
  referenceNode: EsTreeNode,
  typeName: string,
): ReadonlyArray<EsTreeNode> => {
  const program = findProgramRoot(referenceNode);
  if (!program) return [];
  let declarations = declarationsByProgram.get(program);
  if (!declarations) {
    declarations = collectDeclarations(program);
    declarationsByProgram.set(program, declarations);
  }
  return declarations.get(typeName) ?? [];
};
