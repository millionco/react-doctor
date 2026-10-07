import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticRouteProperty } from "./get-static-route-property.js";
import { isDefinitelyFalsyExpression } from "./is-definitely-falsy-expression.js";
import type { RuleContext } from "./rule-context.js";

export const hasActiveRouteProperty = (
  context: RuleContext,
  routeObject: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): boolean => {
  const property = getStaticRouteProperty(routeObject, propertyName);
  return property !== null && !isDefinitelyFalsyExpression(property.value, context.scopes);
};
