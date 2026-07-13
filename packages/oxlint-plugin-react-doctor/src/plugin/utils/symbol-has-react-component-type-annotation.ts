import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isImportedFromReact } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";

const REACT_COMPONENT_TYPE_NAMES: ReadonlySet<string> = new Set([
  "ComponentClass",
  "ComponentType",
  "FC",
  "FunctionComponent",
]);

const findVisibleSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  let scope = scopes.scopeFor(identifier);
  while (true) {
    const symbol = scope.symbolsByName.get(identifier.name);
    if (symbol) return symbol;
    if (!scope.parent) return null;
    scope = scope.parent;
  }
};

const isReactNamespaceType = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = findVisibleSymbol(identifier, scopes);
  return Boolean(
    symbol &&
    isImportedFromReact(symbol) &&
    (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")),
  );
};

const isReactComponentType = (
  typeNode: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (!typeNode) return false;
  if (isNodeOfType(typeNode, "TSTypeAnnotation")) {
    return isReactComponentType(typeNode.typeAnnotation, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(typeNode, "TSIntersectionType")) {
    return (typeNode.types ?? []).some((member) =>
      isReactComponentType(member, scopes, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (isNodeOfType(typeName, "TSQualifiedName")) {
    return (
      isNodeOfType(typeName.left, "Identifier") &&
      isNodeOfType(typeName.right, "Identifier") &&
      REACT_COMPONENT_TYPE_NAMES.has(typeName.right.name) &&
      isReactNamespaceType(typeName.left, scopes)
    );
  }
  if (!isNodeOfType(typeName, "Identifier")) return false;
  const typeSymbol = findVisibleSymbol(typeName, scopes);
  if (!typeSymbol || visitedSymbolIds.has(typeSymbol.id)) return false;
  if (isImportedFromReact(typeSymbol)) {
    const importedName = getImportedName(typeSymbol.declarationNode);
    return Boolean(importedName && REACT_COMPONENT_TYPE_NAMES.has(importedName));
  }
  if (!isNodeOfType(typeSymbol.declarationNode, "TSTypeAliasDeclaration")) return false;
  visitedSymbolIds.add(typeSymbol.id);
  return isReactComponentType(typeSymbol.declarationNode.typeAnnotation, scopes, visitedSymbolIds);
};

export const symbolHasReactComponentTypeAnnotation = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const bindingIdentifier = symbol.bindingIdentifier;
  return (
    isNodeOfType(bindingIdentifier, "Identifier") &&
    isReactComponentType(bindingIdentifier.typeAnnotation, scopes, new Set())
  );
};
