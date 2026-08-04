import ts from "typescript";
import { ReactClassComponentBase } from "../types.js";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";
import type { ReactAnalysisContext } from "../types.js";
import { getResolvedSymbol } from "./get-resolved-symbol.js";

const getEnclosingClass = (node: ts.Node): ts.ClassLikeDeclaration | null => {
  let currentNode: ts.Node | undefined = node.parent;
  while (currentNode) {
    if (ts.isClassLike(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

export const isReactSetStateCall = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): boolean => {
  const callTarget = unwrapTypescriptExpression(callExpression.expression);
  if (
    !ts.isPropertyAccessExpression(callTarget) ||
    callTarget.expression.kind !== ts.SyntaxKind.ThisKeyword ||
    callTarget.name.text !== "setState"
  ) {
    return false;
  }
  const symbol = getResolvedSymbol(callTarget.name, context.typeChecker);
  return Boolean(
    symbol?.declarations?.some((declaration) => {
      const enclosingClass = getEnclosingClass(declaration);
      return Boolean(
        declaration.getSourceFile().isDeclarationFile &&
        enclosingClass?.name &&
        ts.isIdentifier(enclosingClass.name) &&
        enclosingClass.name.text === ReactClassComponentBase.Component,
      );
    }),
  );
};
