import { defineRule } from "../../utils/define-rule.js";
import { containsReactRouterExportUsage } from "../../utils/contains-react-router-export-usage.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const DESCENDANT_ROUTE_EXPORT_NAMES = new Set(["Routes", "useRoutes"]);

const getInlineRouteContent = (
  routeObject: EsTreeNodeOfType<"ObjectExpression">,
): EsTreeNode | null => {
  const componentProperty = getStaticRouteProperty(routeObject, "Component");
  if (componentProperty !== null && isFunctionLike(componentProperty.value)) {
    return componentProperty.value;
  }
  const elementProperty = getStaticRouteProperty(routeObject, "element");
  return elementProperty?.value ?? null;
};

export const reactRouterDescendantRoutesRequireSplat = wrapReactRouterRule(
  defineRule({
    id: "react-router-descendant-routes-require-splat",
    title: "Parent path cannot match descendant routes",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "error",
    recommendation:
      "End the mounting route path with /* so its descendant Routes tree can match deeper URLs.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        const pathProperty = getStaticRouteProperty(node, "path");
        if (pathProperty === null) return;
        const routePath = getStaticStringExpression(pathProperty.value);
        if (routePath === null || routePath === "*" || routePath.endsWith("/*")) return;
        const routeContent = getInlineRouteContent(node);
        if (routeContent === null) return;
        if (!containsReactRouterExportUsage(context, routeContent, DESCENDANT_ROUTE_EXPORT_NAMES)) {
          return;
        }
        context.report({
          node: pathProperty,
          message: `Route path '${routePath}' mounts a descendant route tree but does not end with /*.`,
        });
      },
    }),
  }),
);
