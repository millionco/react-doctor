import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "./get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const ROUTE_CONFIG_EXPORT_NAMES = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "useRoutes",
]);

export const isStaticReactRouterRouteObject = (
  context: RuleContext,
  routeObject: EsTreeNodeOfType<"ObjectExpression">,
): boolean => {
  const routeArray = routeObject.parent;
  if (!isNodeOfType(routeArray, "ArrayExpression")) return false;
  const arrayParent = routeArray.parent;
  if (isNodeOfType(arrayParent, "CallExpression") && arrayParent.arguments?.[0] === routeArray) {
    if (!isNodeOfType(arrayParent.callee, "Identifier")) return false;
    const importedName = getImportedNameFromReactRouter(
      context,
      arrayParent.callee,
      arrayParent.callee.name,
    );
    return importedName !== null && ROUTE_CONFIG_EXPORT_NAMES.has(importedName);
  }
  if (!isNodeOfType(arrayParent, "Property")) return false;
  if (getStaticPropertyKeyName(arrayParent, { allowComputedString: true }) !== "children") {
    return false;
  }
  const parentRoute = arrayParent.parent;
  return (
    isNodeOfType(parentRoute, "ObjectExpression") &&
    isStaticReactRouterRouteObject(context, parentRoute)
  );
};
