import ts from "typescript";

export const hasConditionalAncestor = (
  node: ts.Node,
  ownerFunction: ts.FunctionLikeDeclaration,
): boolean => {
  let currentNode = node;
  while (currentNode !== ownerFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return true;
    if (
      ts.isIfStatement(parentNode) ||
      ts.isConditionalExpression(parentNode) ||
      ts.isSwitchStatement(parentNode) ||
      ts.isForStatement(parentNode) ||
      ts.isForInStatement(parentNode) ||
      ts.isForOfStatement(parentNode) ||
      ts.isWhileStatement(parentNode) ||
      ts.isDoStatement(parentNode) ||
      ts.isTryStatement(parentNode) ||
      (ts.isBinaryExpression(parentNode) &&
        (parentNode.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          parentNode.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parentNode.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      return true;
    }
    currentNode = parentNode;
  }
  return false;
};
