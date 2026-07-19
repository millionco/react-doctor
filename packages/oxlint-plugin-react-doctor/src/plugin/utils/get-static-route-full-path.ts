import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticRouteProperty } from "./get-static-route-property.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticRouteFullPath = (
  routeObject: EsTreeNodeOfType<"ObjectExpression">,
): string | null => {
  const routeObjects: EsTreeNodeOfType<"ObjectExpression">[] = [];
  let current: EsTreeNode | null | undefined = routeObject;
  while (isNodeOfType(current, "ObjectExpression")) {
    routeObjects.unshift(current);
    const routeArray: EsTreeNode | null | undefined = current.parent;
    const childrenProperty: EsTreeNode | null | undefined = routeArray?.parent;
    current = isNodeOfType(routeArray, "ArrayExpression") ? childrenProperty?.parent : null;
  }

  const pathSegments: string[] = [];
  for (const currentRoute of routeObjects) {
    const pathProperty = getStaticRouteProperty(currentRoute, "path");
    if (pathProperty === null) continue;
    const routePath = getStaticStringExpression(pathProperty.value);
    if (routePath === null) return null;
    if (routePath.startsWith("/")) pathSegments.length = 0;
    pathSegments.push(routePath.replace(/^\/+|\/+$/g, ""));
  }
  return `/${pathSegments.filter(Boolean).join("/")}`;
};
