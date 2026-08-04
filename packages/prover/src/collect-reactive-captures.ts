import ts from "typescript";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";

export interface ReactiveCapture {
  key: string;
  node: ts.Identifier;
  symbol: ts.Symbol;
}

const getCaptureKey = (identifier: ts.Identifier): string => {
  let currentNode: ts.Node = identifier;
  while (
    ts.isPropertyAccessExpression(currentNode.parent) &&
    currentNode.parent.expression === currentNode
  ) {
    currentNode = currentNode.parent;
  }
  return currentNode.getText();
};

export const collectReactiveCaptures = (
  callback: ts.FunctionLikeDeclaration,
  owner: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
  stableSymbols: ReadonlySet<ts.Symbol>,
): ReadonlyArray<ReactiveCapture> => {
  const captures = new Map<string, ReactiveCapture>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
      const identifierSymbol = typeChecker.getSymbolAtLocation(node);
      if (identifierSymbol && !stableSymbols.has(identifierSymbol)) {
        const isReactiveCapture = Boolean(
          identifierSymbol.declarations?.some(
            (declaration) =>
              isNodeWithin(declaration, owner) && !isNodeWithin(declaration, callback),
          ),
        );
        if (isReactiveCapture) {
          const key = getCaptureKey(node);
          captures.set(key, { key, node, symbol: identifierSymbol });
        }
      }
    }
    node.forEachChild(visit);
  };
  callback.forEachChild(visit);
  return [...captures.values()];
};
