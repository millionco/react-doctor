import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const isBindingForObjectPatternProperty = (
  identifier: EsTreeNode,
  objectPattern: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier") || !isNodeOfType(objectPattern, "ObjectPattern")) {
    return false;
  }
  const identifierSymbol = scopes.symbolFor(identifier);
  return objectPattern.properties.some((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== propertyName
    ) {
      return false;
    }
    const value = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    return (
      isNodeOfType(value, "Identifier") && scopes.symbolFor(value)?.id === identifierSymbol?.id
    );
  });
};

const isCallbackStateObject = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (!isFunctionLike(callback)) return false;
  const candidate = stripParenExpression(expression);
  const firstParameter = callback.params[0];
  const stateParameter = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  if (
    isNodeOfType(candidate, "Identifier") &&
    isNodeOfType(stateParameter, "Identifier") &&
    scopes.symbolFor(candidate)?.id === scopes.symbolFor(stateParameter)?.id
  ) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isCallbackStateObject(symbol.initializer, callback, scopes, visitedSymbolIds);
};

export const isR3fCallbackStateProperty = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!isFunctionLike(callback)) return false;
  const strippedExpression = stripParenExpression(expression);
  const candidate = isNodeOfType(strippedExpression, "AssignmentPattern")
    ? stripParenExpression(strippedExpression.left)
    : strippedExpression;
  const firstParameter = callback.params[0];
  const stateParameter = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  if (
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyName(candidate) === propertyName &&
    isCallbackStateObject(candidate.object, callback, scopes, new Set(visitedSymbolIds))
  ) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (
    stateParameter &&
    isBindingForObjectPatternProperty(candidate, stateParameter, propertyName, scopes)
  ) {
    return true;
  }
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (
    symbol.kind === "const" &&
    symbol.initializer &&
    symbol.references.every((reference) => reference.flag === "read")
  ) {
    visitedSymbolIds.add(symbol.id);
    if (
      isR3fCallbackStateProperty(
        symbol.initializer,
        callback,
        propertyName,
        scopes,
        visitedSymbolIds,
      )
    ) {
      return true;
    }
  }
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "VariableDeclarator") || !declaration.init) return false;
  return (
    isBindingForObjectPatternProperty(candidate, declaration.id, propertyName, scopes) &&
    isCallbackStateObject(declaration.init, callback, scopes, new Set(visitedSymbolIds))
  );
};
