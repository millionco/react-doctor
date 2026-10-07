import { defineRule } from "../../utils/define-rule.js";
import { containsReactRouterExportUsage } from "../../utils/contains-react-router-export-usage.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { hasActiveRouteProperty } from "../../utils/has-active-route-property.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const OUTLET_EXPORT_NAMES = new Set(["Outlet", "useOutlet"]);

const containsDelegatedComponent = (routeContent: EsTreeNode): boolean => {
  let hasDelegatedComponent = false;
  walkAst(routeContent, (descendant) => {
    if (descendant !== routeContent && isFunctionLike(descendant)) return false;
    if (!isNodeOfType(descendant, "JSXElement")) return;
    const openingName = descendant.openingElement.name;
    if (
      !isNodeOfType(openingName, "JSXIdentifier") ||
      openingName.name[0]?.toUpperCase() === openingName.name[0]
    ) {
      hasDelegatedComponent = true;
      return false;
    }
  });
  return hasDelegatedComponent;
};

const getResolvedInlineRouteContent = (
  routeObject: EsTreeNodeOfType<"ObjectExpression">,
): EsTreeNode | null => {
  const componentProperty = getStaticRouteProperty(routeObject, "Component");
  if (componentProperty !== null && isFunctionLike(componentProperty.value)) {
    if (containsDelegatedComponent(componentProperty.value)) return null;
    return componentProperty.value;
  }
  const elementProperty = getStaticRouteProperty(routeObject, "element");
  if (
    elementProperty !== null &&
    (isNodeOfType(elementProperty.value, "JSXElement") ||
      isNodeOfType(elementProperty.value, "JSXFragment"))
  ) {
    if (containsDelegatedComponent(elementProperty.value)) return null;
    return elementProperty.value;
  }
  return null;
};

export const reactRouterNestedRouteRequiresOutlet = wrapReactRouterRule(
  defineRule({
    id: "react-router-nested-route-requires-outlet",
    title: "Nested routes have no Outlet",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "error",
    recommendation: "Render <Outlet /> from the parent route component where child routes belong.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        if (!hasActiveRouteProperty(context, node, "children")) return;
        const routeContent = getResolvedInlineRouteContent(node);
        if (routeContent === null) return;
        if (containsReactRouterExportUsage(context, routeContent, OUTLET_EXPORT_NAMES)) return;
        context.report({
          node,
          message:
            "This parent route has children but its resolved inline UI does not render Outlet.",
        });
      },
    }),
  }),
);
