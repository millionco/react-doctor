import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ImportedApiReference {
  readonly source: string;
  readonly importedName: string | null;
  readonly isNamespace: boolean;
}

const resolveImportSymbol = (symbol: SymbolDescriptor): ImportedApiReference | null => {
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  if (!importDeclaration || typeof importDeclaration.source.value !== "string") return null;
  if (
    importDeclaration.importKind === "type" ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  if (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) {
    return {
      source: importDeclaration.source.value,
      importedName: null,
      isNamespace: true,
    };
  }
  if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) {
    return {
      source: importDeclaration.source.value,
      importedName: "default",
      isNamespace: false,
    };
  }
  const importedName = getImportedName(symbol.declarationNode);
  return importedName
    ? {
        source: importDeclaration.source.value,
        importedName,
        isNamespace: false,
      }
    : null;
};

const resolveIdentifierReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): ImportedApiReference | null => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  if (symbol.kind === "import") return resolveImportSymbol(symbol);
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  visitedSymbolIds.add(symbol.id);
  if (
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(symbol.declarationNode.id, "ObjectPattern")
  ) {
    const receiver = resolveImportedApiReference(symbol.initializer, scopes, visitedSymbolIds);
    if (!receiver || (!receiver.isNamespace && receiver.importedName !== "default")) return null;
    for (const property of symbol.declarationNode.id.properties) {
      if (!isNodeOfType(property, "Property")) continue;
      const propertyValue = isNodeOfType(property.value, "AssignmentPattern")
        ? property.value.left
        : property.value;
      if (propertyValue !== symbol.bindingIdentifier) continue;
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      return propertyName
        ? { source: receiver.source, importedName: propertyName, isNamespace: false }
        : null;
    }
    return null;
  }
  return resolveImportedApiReference(symbol.initializer, scopes, visitedSymbolIds);
};

export const resolveImportedApiReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): ImportedApiReference | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    return resolveIdentifierReference(unwrappedExpression, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(unwrappedExpression);
  if (!propertyName) return null;
  const receiver = resolveImportedApiReference(
    unwrappedExpression.object,
    scopes,
    visitedSymbolIds,
  );
  if (!receiver || (!receiver.isNamespace && receiver.importedName !== "default")) return null;
  return {
    source: receiver.source,
    importedName: propertyName,
    isNamespace: false,
  };
};
