import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { functionReturnsMatchingExpression } from "../../../utils/function-returns-matching-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isR3fApiCall } from "./is-r3f-api-call.js";
import { isR3fCallbackStateProperty } from "./is-r3f-callback-state-property.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";

const isReadOnlyConstAlias = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.initializer &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const isWholeUseThreeState = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "CallExpression") &&
    candidate.arguments.length === 0 &&
    isR3fApiCall(candidate, "useThree", context.scopes)
  ) {
    return true;
  }
  if (!isReadOnlyConstAlias(candidate, context.scopes)) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  return isWholeUseThreeState(symbol.initializer, context, visitedSymbolIds);
};

const isPropertyBindingFromWholeState = (
  identifier: EsTreeNode,
  propertyName: string,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !declaration.init ||
    !isNodeOfType(declaration.id, "ObjectPattern")
  ) {
    return false;
  }
  const isMatchingBinding = declaration.id.properties.some((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== propertyName
    ) {
      return false;
    }
    const value = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    return isNodeOfType(value, "Identifier") && context.scopes.symbolFor(value)?.id === symbol.id;
  });
  if (!isMatchingBinding) return false;
  visitedSymbolIds.add(symbol.id);
  return isWholeUseThreeState(declaration.init, context, visitedSymbolIds);
};

const selectorReturnsStateProperty = (
  call: EsTreeNode,
  propertyName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(call, "CallExpression") || !isR3fApiCall(call, "useThree", context.scopes)) {
    return false;
  }
  const selectorArgument = call.arguments[0];
  if (!selectorArgument || isNodeOfType(selectorArgument, "SpreadElement")) return false;
  const selector = resolveLocalReactCallback(selectorArgument, context.scopes);
  return Boolean(
    selector &&
    functionReturnsMatchingExpression(
      selector,
      context.scopes,
      (returnedExpression) =>
        isR3fCallbackStateProperty(returnedExpression, selector, propertyName, context.scopes),
      context.cfg,
      "every",
    ),
  );
};

export const isR3fUseThreeStateProperty = (
  expression: EsTreeNode,
  propertyName: string,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (selectorReturnsStateProperty(candidate, propertyName, context)) return true;
  if (
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyName(candidate) === propertyName &&
    isWholeUseThreeState(candidate.object, context, new Set(visitedSymbolIds))
  ) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (
    isPropertyBindingFromWholeState(candidate, propertyName, context, new Set(visitedSymbolIds))
  ) {
    return true;
  }
  if (!isReadOnlyConstAlias(candidate, context.scopes)) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  return isR3fUseThreeStateProperty(symbol.initializer, propertyName, context, visitedSymbolIds);
};
