import ts from "typescript";
import { isNodeWithin } from "../is-node-within.js";
import { resolveCallableExpression } from "../resolve-callable-expression.js";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./collect-symbol-writes.js";
import { isDirectComponentPropertiesObject } from "./is-direct-component-properties-object.js";

export const isJsxSpreadSourceComplete = (
  expression: ts.Expression,
  ownerFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => {
  const visitedSymbols = new Set<ts.Symbol>();
  const hasOnlyImmutableSymbolUses = (
    symbol: ts.Symbol,
    declaration: ts.VariableDeclaration,
    currentExpression: ts.Expression,
  ): boolean => {
    let hasUnknownUse = false;
    const visitNode = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        typeChecker.getSymbolAtLocation(node) === symbol &&
        node !== declaration.name &&
        node !== currentExpression
      ) {
        const parent = node.parent;
        if (
          ts.isJsxSpreadAttribute(parent) &&
          unwrapTypescriptExpression(parent.expression) === node
        ) {
          return;
        }
        if (
          (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === node
        ) {
          if (ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
            hasUnknownUse = true;
          }
          return;
        }
        hasUnknownUse = true;
      }
      node.forEachChild(visitNode);
    };
    declaration.getSourceFile().forEachChild(visitNode);
    return !hasUnknownUse;
  };
  const visitExpression = (candidateExpression: ts.Expression): boolean => {
    const unwrappedExpression = unwrapTypescriptExpression(candidateExpression);
    if (isDirectComponentPropertiesObject(unwrappedExpression, ownerFunction, typeChecker)) {
      return true;
    }
    if (ts.isObjectLiteralExpression(unwrappedExpression)) {
      return resolveCallableExpression(unwrappedExpression, typeChecker).isComplete;
    }
    if (!ts.isIdentifier(unwrappedExpression)) return false;
    const directSymbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
    const symbol =
      directSymbol && (directSymbol.flags & ts.SymbolFlags.Alias) !== 0
        ? typeChecker.getAliasedSymbol(directSymbol)
        : directSymbol;
    if (!symbol || visitedSymbols.has(symbol)) return false;
    visitedSymbols.add(symbol);
    const declaration = symbol.declarations?.[0];
    if (
      !declaration ||
      collectSymbolWrites(symbol, declaration.getSourceFile(), typeChecker).length > 0
    ) {
      return false;
    }
    for (const symbolDeclaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(symbolDeclaration) &&
        ts.isVariableDeclarationList(symbolDeclaration.parent) &&
        Boolean(symbolDeclaration.parent.flags & ts.NodeFlags.Const) &&
        isNodeWithin(symbolDeclaration, ownerFunction) &&
        symbolDeclaration.initializer &&
        hasOnlyImmutableSymbolUses(symbol, symbolDeclaration, unwrappedExpression) &&
        visitExpression(symbolDeclaration.initializer)
      ) {
        return true;
      }
    }
    return false;
  };
  return visitExpression(expression);
};
