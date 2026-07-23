import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";

export const resolveImportedJsxComponentName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  moduleSource: string,
  scopes: ScopeAnalysis,
): string | null => {
  const elementName = openingElement.name;
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const symbol = scopes.symbolFor(elementName);
    if (!symbol || symbol.kind !== "import") return null;
    const importDeclaration = getImportDeclarationForSymbol(symbol);
    if (
      !importDeclaration ||
      importDeclaration.source.value !== moduleSource ||
      isTypeOnlyImport(importDeclaration)
    ) {
      return null;
    }
    if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return "default";
    if (!isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return null;
    if (symbol.declarationNode.importKind === "type") return null;
    return getImportedName(symbol.declarationNode) ?? null;
  }
  if (
    !isNodeOfType(elementName, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object, "JSXIdentifier") ||
    !isNodeOfType(elementName.property, "JSXIdentifier")
  ) {
    return null;
  }
  const namespaceSymbol = scopes.symbolFor(elementName.object);
  if (
    !namespaceSymbol ||
    namespaceSymbol.kind !== "import" ||
    !isNodeOfType(namespaceSymbol.declarationNode, "ImportNamespaceSpecifier")
  ) {
    return null;
  }
  const importDeclaration = getImportDeclarationForSymbol(namespaceSymbol);
  if (
    !importDeclaration ||
    importDeclaration.source.value !== moduleSource ||
    isTypeOnlyImport(importDeclaration)
  ) {
    return null;
  }
  return elementName.property.name;
};
