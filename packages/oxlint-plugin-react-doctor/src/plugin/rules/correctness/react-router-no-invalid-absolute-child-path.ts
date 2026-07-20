import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { getStaticRouteFullPath } from "../../utils/get-static-route-full-path.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const DYNAMIC_ROUTE_PATH_PATTERN = /[:*?]/;

const getParentRoutePath = (routeObject: EsTreeNodeOfType<"ObjectExpression">): string | null => {
  const routeArray: EsTreeNode | null | undefined = routeObject.parent;
  const childrenProperty: EsTreeNode | null | undefined = routeArray?.parent;
  const parentRoute: EsTreeNode | null | undefined = childrenProperty?.parent;
  return isNodeOfType(routeArray, "ArrayExpression") &&
    isNodeOfType(childrenProperty, "Property") &&
    isNodeOfType(parentRoute, "ObjectExpression")
    ? getStaticRouteFullPath(parentRoute)
    : "/";
};

export const reactRouterNoInvalidAbsoluteChildPath = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-invalid-absolute-child-path",
    title: "Absolute child path escapes its parent",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "error",
    recommendation:
      "Make the child path relative, or prefix its absolute path with the complete parent route path.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        const pathProperty = getStaticRouteProperty(node, "path");
        if (pathProperty === null) return;
        const routePath = getStaticStringExpression(pathProperty.value);
        if (routePath === null || !routePath.startsWith("/")) return;
        const parentPath = getParentRoutePath(node);
        if (parentPath === null || parentPath === "/") return;
        if (DYNAMIC_ROUTE_PATH_PATTERN.test(parentPath)) return;
        if (routePath === parentPath || routePath.startsWith(`${parentPath}/`)) return;
        context.report({
          node: pathProperty,
          message: `Absolute child path '${routePath}' does not begin with parent path '${parentPath}'.`,
        });
      },
    }),
  }),
);
