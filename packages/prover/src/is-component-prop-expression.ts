import ts from "typescript";
import { getRootIdentifier } from "./get-root-identifier.js";

export const isComponentPropExpression = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => {
  const rootIdentifier = getRootIdentifier(expression);
  const symbol = rootIdentifier ? typeChecker.getSymbolAtLocation(rootIdentifier) : null;
  return Boolean(
    symbol?.declarations?.some((declaration) => {
      let currentNode: ts.Node = declaration;
      while (currentNode !== functionNode) {
        if (ts.isParameter(currentNode)) {
          return functionNode.parameters.includes(currentNode);
        }
        if (!currentNode.parent) return false;
        currentNode = currentNode.parent;
      }
      return false;
    }),
  );
};
