import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const readonlySymbols = new WeakMap<SymbolDescriptor, boolean>();
const importedOrigins = new WeakMap<SymbolDescriptor, boolean>();

const getReadonlyCalleeSymbol = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = scopes.referenceFor(callee);
  const symbol = reference?.resolvedSymbol;
  if (!symbol || reference.flag !== "read") return null;
  let isReadonly = readonlySymbols.get(symbol);
  if (isReadonly === undefined) {
    isReadonly = symbol.references.every(
      (candidateReference) =>
        candidateReference.flag === "read" &&
        !isMemberMutationTarget(candidateReference.identifier),
    );
    readonlySymbols.set(symbol, isReadonly);
  }
  if (!isReadonly) return null;
  if (getValueImportDeclaration(symbol)) return symbol;
  return getDirectConstInitializer(symbol) && symbol.declarationNode.range[1] <= callee.range[0]
    ? symbol
    : null;
};

const hasImportedOrigin = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const visitedSymbols = new Set<SymbolDescriptor>();
  let currentSymbol: SymbolDescriptor | null = symbol;
  let hasValueImport = false;
  while (currentSymbol && !visitedSymbols.has(currentSymbol)) {
    const cachedOrigin = importedOrigins.get(currentSymbol);
    if (cachedOrigin !== undefined) {
      hasValueImport = cachedOrigin;
      break;
    }
    visitedSymbols.add(currentSymbol);
    if (getValueImportDeclaration(currentSymbol)) {
      hasValueImport = !isNodeOfType(currentSymbol.declarationNode, "ImportNamespaceSpecifier");
      break;
    }
    const initializer = getDirectConstInitializer(currentSymbol);
    currentSymbol = initializer
      ? getReadonlyCalleeSymbol(stripParenExpression(initializer), scopes)
      : null;
  }
  for (const visitedSymbol of visitedSymbols) importedOrigins.set(visitedSymbol, hasValueImport);
  return hasValueImport;
};

export const containsImportedValueCall = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let foundImportedCall = false;
  walkAst(expression, (node) => {
    if (foundImportedCall) return false;
    if (!isNodeOfType(node, "CallExpression") || node.optional) return;
    const symbol = getReadonlyCalleeSymbol(stripParenExpression(node.callee), scopes);
    if (symbol) foundImportedCall = hasImportedOrigin(symbol, scopes);
  });
  return foundImportedCall;
};
