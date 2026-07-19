import { getRangeStart } from "./get-range-start.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

export const resolveExpressionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (!symbol) {
      return context.scopes.isGlobalReference(unwrappedExpression)
        ? `global:${unwrappedExpression.name}`
        : null;
    }
    if (visitedSymbolIds.has(symbol.id)) return `symbol:${symbol.id}`;
    visitedSymbolIds.add(symbol.id);
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const variableDeclarator = bindingPattern?.parent;
    const bindingPropertyName = isNodeOfType(bindingProperty, "Property")
      ? getStaticPropertyKeyName(bindingProperty)
      : null;
    if (
      bindingPropertyName &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      isNodeOfType(variableDeclarator, "VariableDeclarator") &&
      variableDeclarator.id === bindingPattern
    ) {
      const objectKey = resolveExpressionKey(variableDeclarator.init, context, visitedSymbolIds);
      return objectKey ? `${objectKey}.${bindingPropertyName}` : `symbol:${symbol.id}`;
    }
    const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
    if (
      symbol.kind === "const" &&
      initializer &&
      (isNodeOfType(initializer, "Identifier") || isNodeOfType(initializer, "MemberExpression"))
    ) {
      return resolveExpressionKey(initializer, context, visitedSymbolIds) ?? `symbol:${symbol.id}`;
    }
    return `symbol:${symbol.id}`;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    const propertyName = getStaticPropertyKeyName(unwrappedExpression, {
      allowComputedString: true,
    });
    if (!propertyName) return null;
    const objectKey = resolveExpressionKey(unwrappedExpression.object, context, visitedSymbolIds);
    return objectKey ? `${objectKey}.${propertyName}` : null;
  }
  if (isNodeOfType(unwrappedExpression, "ThisExpression")) return "this";
  if (
    isNodeOfType(unwrappedExpression, "Literal") &&
    (typeof unwrappedExpression.value === "string" || typeof unwrappedExpression.value === "number")
  ) {
    return `literal:${String(unwrappedExpression.value)}`;
  }
  if (isFunctionLike(unwrappedExpression)) {
    const rangeStart = getRangeStart(unwrappedExpression);
    return rangeStart === null ? null : `function:${rangeStart}`;
  }
  return null;
};
