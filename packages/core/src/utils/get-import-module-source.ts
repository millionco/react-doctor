import ts from "typescript";

export const getImportModuleSource = (node: ts.Node): string | null => {
  let currentNode: ts.Node | undefined = node;
  while (currentNode) {
    if (ts.isImportDeclaration(currentNode) && ts.isStringLiteral(currentNode.moduleSpecifier)) {
      return currentNode.moduleSpecifier.text;
    }
    currentNode = currentNode.parent;
  }
  return null;
};
