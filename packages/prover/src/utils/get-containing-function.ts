import ts from "typescript";
import { isFunctionBoundary } from "../is-function-boundary.js";

export const getContainingFunction = (node: ts.Node): ts.FunctionLikeDeclaration | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isFunctionBoundary(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};
