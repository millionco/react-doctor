import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const GLOBAL_SELF_PROPERTY_NAMES = new Set(["global", "globalThis", "self", "window"]);

export const isProvenGlobalObjectReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  let currentExpression = expression;
  while (true) {
    const strippedExpression = stripParenExpression(currentExpression);
    if (!isNodeOfType(strippedExpression, "Identifier")) return false;
    if (
      (strippedExpression.name === "globalThis" ||
        strippedExpression.name === "window" ||
        strippedExpression.name === "self" ||
        strippedExpression.name === "global") &&
      scopes.isGlobalReference(strippedExpression)
    ) {
      return true;
    }
    const symbol = scopes.symbolFor(strippedExpression);
    if (
      !symbol?.initializer ||
      symbol.kind !== "const" ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
    ) {
      return false;
    }
    const declaration = symbol.declarationNode;
    const initializer = declaration.init;
    if (!initializer) return false;
    const isDirectIdentifierAlias =
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id === symbol.bindingIdentifier &&
      initializer === symbol.initializer;
    const bindingProperty = symbol.bindingIdentifier.parent;
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    const isDirectGlobalSelfAlias =
      isNodeOfType(declaration.id, "ObjectPattern") &&
      isNodeOfType(bindingProperty, "Property") &&
      bindingProperty.value === symbol.bindingIdentifier &&
      bindingProperty.parent === declaration.id &&
      destructuredPropertyName !== null &&
      GLOBAL_SELF_PROPERTY_NAMES.has(destructuredPropertyName);
    if (!isDirectIdentifierAlias && !isDirectGlobalSelfAlias) return false;
    visitedSymbolIds.add(symbol.id);
    currentExpression = initializer;
  }
};

export const isProvenGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  let currentExpression = expression;
  while (true) {
    const strippedExpression = stripParenExpression(currentExpression);
    if (!isNodeOfType(strippedExpression, "Identifier")) {
      return (
        isNodeOfType(strippedExpression, "MemberExpression") &&
        getStaticPropertyName(strippedExpression) === namespaceName &&
        isProvenGlobalObjectReference(strippedExpression.object, scopes)
      );
    }
    if (strippedExpression.name === namespaceName && scopes.isGlobalReference(strippedExpression)) {
      return true;
    }
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol || symbol.kind !== "const" || visitedSymbolIds.has(symbol.id)) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    const declaration = symbol.declarationNode;
    const bindingIdentifier = symbol.bindingIdentifier;
    const bindingProperty = bindingIdentifier.parent;
    if (
      getDestructuredBindingPropertyName(bindingIdentifier) === namespaceName &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.id, "ObjectPattern") &&
      isNodeOfType(bindingProperty, "Property") &&
      bindingProperty.value === bindingIdentifier &&
      bindingProperty.parent === declaration.id &&
      declaration.init
    ) {
      return isProvenGlobalObjectReference(declaration.init, scopes);
    }
    const directInitializer = getDirectConstInitializer(symbol);
    if (!directInitializer) return false;
    currentExpression = directInitializer;
  }
};
