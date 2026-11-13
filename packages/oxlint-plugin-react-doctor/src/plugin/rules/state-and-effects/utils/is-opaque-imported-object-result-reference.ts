import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isOpaqueImportedObjectResultReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let candidate = identifier;
  const visitedSymbolIds = new Set<number>();
  while (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some(
        (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
      )
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    const declaration = symbol.declarationNode;
    if (!isNodeOfType(declaration, "VariableDeclarator") || !declaration.init) return false;
    const initializer = stripParenExpression(declaration.init);
    if (isNodeOfType(declaration.id, "Identifier")) {
      if (!isNodeOfType(initializer, "Identifier")) return false;
      candidate = initializer;
      continue;
    }
    if (
      !isNodeOfType(declaration.id, "ObjectPattern") ||
      !isNodeOfType(initializer, "CallExpression") ||
      initializer.optional
    ) {
      return false;
    }
    let selectedPropertyName: string | null = null;
    const propertyNames = new Set<string>();
    for (const property of declaration.id.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        !isNodeOfType(property.value, "Identifier")
      ) {
        return false;
      }
      const propertyName = getStaticPropertyKeyName(property);
      if (propertyName === null || propertyNames.has(propertyName)) return false;
      propertyNames.add(propertyName);
      if (property.value === symbol.bindingIdentifier) selectedPropertyName = propertyName;
    }
    if (selectedPropertyName === null) return false;
    const callee = stripParenExpression(initializer.callee);
    if (!isNodeOfType(callee, "Identifier")) return false;
    const importedSymbol = scopes.symbolFor(callee);
    if (
      !importedSymbol ||
      importedSymbol.references.some(
        (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
      ) ||
      (!isNodeOfType(importedSymbol.declarationNode, "ImportSpecifier") &&
        !isNodeOfType(importedSymbol.declarationNode, "ImportDefaultSpecifier"))
    ) {
      return false;
    }
    const importDeclaration = getValueImportDeclaration(importedSymbol);
    return Boolean(
      isNodeOfType(importDeclaration, "ImportDeclaration") &&
      typeof importDeclaration.source.value === "string" &&
      importDeclaration.source.value !== "react",
    );
  }
  return false;
};
