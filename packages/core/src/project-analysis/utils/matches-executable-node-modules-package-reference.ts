import ts from "typescript";
import { matchesNodeModulesPackageReference } from "./matches-node-modules-package-reference.js";

const isConsumedStringLiteral = (node: ts.StringLiteralLike): boolean => {
  let currentNode: ts.Node = node;
  while (currentNode.parent) {
    const parentNode = currentNode.parent;
    if (
      ts.isCallExpression(parentNode) ||
      ts.isNewExpression(parentNode) ||
      ts.isPropertyAssignment(parentNode) ||
      ts.isExportAssignment(parentNode) ||
      ts.isReturnStatement(parentNode)
    ) {
      return true;
    }
    if (
      ts.isVariableDeclaration(parentNode) ||
      ts.isExpressionStatement(parentNode) ||
      ts.isSourceFile(parentNode)
    ) {
      return false;
    }
    currentNode = parentNode;
  }
  return false;
};

export const matchesExecutableNodeModulesPackageReference = (
  content: string,
  packageName: string,
): boolean => {
  const sourceFile = ts.createSourceFile(
    "node-modules-reference.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let isMatched = false;
  const visit = (node: ts.Node): void => {
    if (isMatched) return;
    if (
      ts.isStringLiteralLike(node) &&
      isConsumedStringLiteral(node) &&
      matchesNodeModulesPackageReference(node.text, packageName)
    ) {
      isMatched = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return isMatched;
};
