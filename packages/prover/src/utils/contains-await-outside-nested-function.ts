import ts from "typescript";
import { isFunctionBoundary } from "../is-function-boundary.js";

export const containsAwaitOutsideNestedFunction = (
  node: ts.Node,
  ownerFunction: ts.FunctionLikeDeclaration,
): boolean => {
  let didFindAwait = false;
  const visit = (currentNode: ts.Node): void => {
    if (didFindAwait || (currentNode !== ownerFunction && isFunctionBoundary(currentNode))) {
      return;
    }
    if (ts.isAwaitExpression(currentNode)) {
      didFindAwait = true;
      return;
    }
    currentNode.forEachChild(visit);
  };
  node.forEachChild(visit);
  return didFindAwait;
};
