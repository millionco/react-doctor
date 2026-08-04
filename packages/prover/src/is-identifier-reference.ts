import ts from "typescript";

export const isIdentifierReference = (identifier: ts.Identifier): boolean => {
  const parentNode = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parentNode) && parentNode.name === identifier) ||
    (ts.isPropertyAssignment(parentNode) && parentNode.name === identifier) ||
    (ts.isMethodDeclaration(parentNode) && parentNode.name === identifier) ||
    (ts.isPropertyDeclaration(parentNode) && parentNode.name === identifier) ||
    (ts.isVariableDeclaration(parentNode) && parentNode.name === identifier) ||
    (ts.isParameter(parentNode) && parentNode.name === identifier) ||
    (ts.isFunctionDeclaration(parentNode) && parentNode.name === identifier) ||
    (ts.isFunctionExpression(parentNode) && parentNode.name === identifier) ||
    ts.isImportClause(parentNode) ||
    ts.isImportSpecifier(parentNode) ||
    ts.isNamespaceImport(parentNode) ||
    ts.isBindingElement(parentNode) ||
    ts.isTypeReferenceNode(parentNode) ||
    ts.isTypeQueryNode(parentNode) ||
    ts.isJsxAttribute(parentNode)
  ) {
    return false;
  }
  return true;
};
