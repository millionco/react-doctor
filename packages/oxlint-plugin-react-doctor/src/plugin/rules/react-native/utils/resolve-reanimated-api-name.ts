import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const REANIMATED_MODULE_SOURCE = "react-native-reanimated";

const getSimpleConstInitializer = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (
    symbol.kind !== "const" ||
    symbol.initializer === null ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return symbol.initializer;
};

const isTypeOnlyImportSymbol = (symbol: SymbolDescriptor): boolean => {
  const declarationNode = symbol.declarationNode;
  if (isNodeOfType(declarationNode, "ImportSpecifier") && declarationNode.importKind === "type") {
    return true;
  }
  const importDeclaration = declarationNode.parent;
  return (
    isNodeOfType(importDeclaration, "ImportDeclaration") && importDeclaration.importKind === "type"
  );
};

const isReanimatedNamespaceReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const symbol = scopes.symbolFor(unwrappedExpression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (symbol.kind === "import") {
    if (isTypeOnlyImportSymbol(symbol)) return false;
    const importBinding = getImportBindingForName(unwrappedExpression, symbol.name);
    return importBinding?.source === REANIMATED_MODULE_SOURCE && importBinding.isNamespace;
  }
  const initializer = getSimpleConstInitializer(symbol);
  return initializer
    ? isReanimatedNamespaceReference(initializer, scopes, visitedSymbolIds)
    : false;
};

const resolveReanimatedApiNameFromExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  supportedApiNames: ReadonlySet<string>,
  visitedSymbolIds: Set<number>,
): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind === "import") {
      if (isTypeOnlyImportSymbol(symbol)) return null;
      const importBinding = getImportBindingForName(unwrappedExpression, symbol.name);
      if (
        importBinding?.source !== REANIMATED_MODULE_SOURCE ||
        importBinding.isNamespace ||
        importBinding.exportedName === null
      ) {
        return null;
      }
      return supportedApiNames.has(importBinding.exportedName) ? importBinding.exportedName : null;
    }
    const initializer = getSimpleConstInitializer(symbol);
    if (!initializer) return null;
    return resolveReanimatedApiNameFromExpression(
      initializer,
      scopes,
      supportedApiNames,
      visitedSymbolIds,
    );
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return null;
  const apiName = getStaticPropertyName(unwrappedExpression);
  if (!apiName || !supportedApiNames.has(apiName)) return null;
  return isReanimatedNamespaceReference(unwrappedExpression.object, scopes, visitedSymbolIds)
    ? apiName
    : null;
};

export const resolveReanimatedApiName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  supportedApiNames: ReadonlySet<string>,
): string | null =>
  resolveReanimatedApiNameFromExpression(
    callExpression.callee,
    scopes,
    supportedApiNames,
    new Set(),
  );
