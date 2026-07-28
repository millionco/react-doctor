import ts from "typescript";
import { REACT_RUNTIME_MODULE_NAMES } from "./constants.js";

const getImportDeclaration = (node: ts.Node): ts.ImportDeclaration | null => {
  let currentNode: ts.Node | undefined = node;
  while (currentNode) {
    if (ts.isImportDeclaration(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

const getImportedName = (declaration: ts.Declaration): string | null => {
  if (!ts.isImportSpecifier(declaration)) return null;
  return (declaration.propertyName ?? declaration.name).text;
};

const isReactImport = (declaration: ts.Declaration): boolean => {
  const importDeclaration = getImportDeclaration(declaration);
  return Boolean(
    importDeclaration &&
    ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
    REACT_RUNTIME_MODULE_NAMES.has(importDeclaration.moduleSpecifier.text),
  );
};

const resolveReactApiName = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: Set<ts.Symbol>,
): string | null => {
  if (ts.isPropertyAccessExpression(expression)) {
    const namespaceSymbol = typeChecker.getSymbolAtLocation(expression.expression);
    if (namespaceSymbol?.declarations?.some(isReactImport)) return expression.name.text;
  }

  const symbol = typeChecker.getSymbolAtLocation(expression);
  if (!symbol || visitedSymbols.has(symbol)) return null;
  visitedSymbols.add(symbol);

  const importedName = symbol.declarations
    ?.filter(isReactImport)
    .map(getImportedName)
    .find((name): name is string => name !== null);
  if (importedName) return importedName;

  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isExpression(declaration.initializer)
    ) {
      const initializerName = resolveReactApiName(
        declaration.initializer,
        typeChecker,
        visitedSymbols,
      );
      if (initializerName) return initializerName;
    }
  }
  return null;
};

export const getCanonicalReactApiName = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): string | null => resolveReactApiName(expression, typeChecker, new Set());
