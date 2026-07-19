import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

export const isRouteRequestExpression = (
  context: RuleContext,
  expression: EsTreeNode,
  routeFunction: EsTreeNode,
): boolean => {
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    if (symbol?.kind !== "parameter" || symbol.scope.node !== routeFunction) return false;
    let bindingNode = symbol.bindingIdentifier;
    if (
      isNodeOfType(bindingNode.parent, "AssignmentPattern") &&
      bindingNode.parent.left === bindingNode
    ) {
      bindingNode = bindingNode.parent;
    }
    const property = bindingNode.parent;
    return Boolean(
      isNodeOfType(property, "Property") &&
      property.value === bindingNode &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "request" &&
      isNodeOfType(property.parent, "ObjectPattern"),
    );
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  if (getStaticPropertyKeyName(expression, { allowComputedString: true }) !== "request") {
    return false;
  }
  if (!isNodeOfType(expression.object, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(expression.object);
  return symbol?.kind === "parameter" && symbol.scope.node === routeFunction;
};
