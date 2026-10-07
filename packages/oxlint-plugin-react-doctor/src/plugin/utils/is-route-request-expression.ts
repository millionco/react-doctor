import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isRouteRequestExpression = (
  context: RuleContext,
  expression: EsTreeNode,
  routeFunction: EsTreeNode,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
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
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  if (getStaticPropertyKeyName(candidate, { allowComputedString: true }) !== "request") {
    return false;
  }
  const object = stripParenExpression(candidate.object);
  if (!isNodeOfType(object, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(object);
  return symbol?.kind === "parameter" && symbol.scope.node === routeFunction;
};
