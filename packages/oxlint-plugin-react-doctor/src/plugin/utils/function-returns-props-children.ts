import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasStaticPropertyWriteBefore } from "./has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const functionReturnsPropsChildren = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow?: ControlFlowAnalysis,
): boolean => {
  if (!isFunctionLike(functionNode) || functionNode.params.length === 0) return false;
  const firstParameter = stripParenExpression(functionNode.params[0]);
  const firstParameterPattern = isNodeOfType(firstParameter, "AssignmentPattern")
    ? stripParenExpression(firstParameter.left)
    : firstParameter;
  const propsParameterSymbol = isNodeOfType(firstParameterPattern, "Identifier")
    ? scopes.symbolFor(firstParameterPattern)
    : null;
  const childrenBindingSymbolIds = new Set<number>();
  if (isNodeOfType(firstParameterPattern, "ObjectPattern")) {
    for (const property of firstParameterPattern.properties) {
      if (
        isNodeOfType(property, "Property") &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) === "children"
      ) {
        const propertyValue = stripParenExpression(property.value);
        const childrenBinding = isNodeOfType(propertyValue, "AssignmentPattern")
          ? stripParenExpression(propertyValue.left)
          : propertyValue;
        if (!isNodeOfType(childrenBinding, "Identifier")) continue;
        const childrenBindingSymbol = scopes.symbolFor(childrenBinding);
        if (childrenBindingSymbol) childrenBindingSymbolIds.add(childrenBindingSymbol.id);
      }
    }
  }
  return functionReturnsMatchingExpression(
    functionNode,
    scopes,
    (expression) => {
      const candidate = stripParenExpression(expression);
      if (isNodeOfType(candidate, "Identifier")) {
        const symbol = scopes.symbolFor(candidate);
        return Boolean(
          symbol &&
          childrenBindingSymbolIds.has(symbol.id) &&
          !hasSymbolWriteBefore(symbol, candidate, scopes),
        );
      }
      if (!isNodeOfType(candidate, "MemberExpression")) return false;
      if (getStaticPropertyName(candidate) !== "children") return false;
      const receiver = stripParenExpression(candidate.object);
      if (!isNodeOfType(receiver, "Identifier")) return false;
      const receiverSymbol = scopes.symbolFor(receiver);
      if (!receiverSymbol || !propsParameterSymbol) return false;
      return (
        receiverSymbol.id === propsParameterSymbol.id &&
        !hasSymbolWriteBefore(receiverSymbol, candidate, scopes) &&
        !hasStaticPropertyWriteBefore(receiver, "children", candidate, scopes)
      );
    },
    controlFlow,
  );
};
