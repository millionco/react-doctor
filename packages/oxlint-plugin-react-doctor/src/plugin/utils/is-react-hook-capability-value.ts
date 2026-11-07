import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactNamespaceImport } from "./is-react-api-call.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isReactHookCapabilityValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind === "import") {
      return (
        getImportDeclarationForSymbol(symbol)?.source.value === "react" &&
        isReactHookName(getImportedName(symbol.declarationNode) ?? "")
      );
    }
    if (
      symbol.kind !== "const" ||
      !symbol.initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
    ) {
      return false;
    }
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    if (destructuredPropertyName) {
      const namespaceExpression = stripParenExpression(symbol.initializer);
      return (
        isReactHookName(destructuredPropertyName) &&
        isNodeOfType(namespaceExpression, "Identifier") &&
        isReactNamespaceImport(namespaceExpression, scopes) &&
        !hasPossibleStaticPropertyMutationOrEscape(
          namespaceExpression,
          destructuredPropertyName,
          scopes,
        )
      );
    }
    if (symbol.declarationNode.id !== symbol.bindingIdentifier) return false;
    return isReactHookCapabilityValue(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(unwrappedExpression);
  if (!propertyName || !isReactHookName(propertyName)) return false;
  const namespaceExpression = stripParenExpression(unwrappedExpression.object);
  return (
    isNodeOfType(namespaceExpression, "Identifier") &&
    isReactNamespaceImport(namespaceExpression, scopes) &&
    !hasPossibleStaticPropertyMutationOrEscape(namespaceExpression, propertyName, scopes)
  );
};
