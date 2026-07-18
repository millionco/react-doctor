import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getGlobalRequireModuleSource } from "../../../utils/get-global-require-module-source.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const getModuleNamespaceSource = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  const candidate = stripParenExpression(expression);
  const requireSource = isNodeOfType(candidate, "CallExpression")
    ? getGlobalRequireModuleSource(candidate, scopes)
    : null;
  if (requireSource !== null) return requireSource;
  if (!isNodeOfType(candidate, "Identifier") && !isNodeOfType(candidate, "JSXIdentifier")) {
    return null;
  }
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  if (
    importDeclaration &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
    typeof importDeclaration.source.value === "string"
  ) {
    return importDeclaration.source.value;
  }
  if (
    symbol.kind === "ts-import-equals" &&
    isNodeOfType(symbol.declarationNode, "TSImportEqualsDeclaration") &&
    isNodeOfType(symbol.declarationNode.moduleReference, "TSExternalModuleReference") &&
    isNodeOfType(symbol.declarationNode.moduleReference.expression, "Literal") &&
    typeof symbol.declarationNode.moduleReference.expression.value === "string"
  ) {
    return symbol.declarationNode.moduleReference.expression.value;
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return getModuleNamespaceSource(symbol.initializer, scopes, visitedSymbolIds);
};
