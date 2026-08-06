import {
  REACT_ROUTER_RENDER_PROPERTY_NAMES,
  REACT_ROUTER_RESOURCE_HANDLER_PROPERTY_NAMES,
} from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { hasActiveRouteProperty } from "../../utils/has-active-route-property.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoEmptyLeafRoute = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-empty-leaf-route",
    title: "Leaf route renders nothing",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "warn",
    recommendation:
      "Add element, Component, or lazy to a UI leaf route, or remove the empty route.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        if (hasActiveRouteProperty(context, node, "children")) return;
        if (
          getStaticRouteProperty(node, "path") === null &&
          getStaticRouteProperty(node, "index") === null
        ) {
          return;
        }
        if (
          REACT_ROUTER_RENDER_PROPERTY_NAMES.some((name) =>
            hasActiveRouteProperty(context, node, name),
          )
        ) {
          return;
        }
        if (
          REACT_ROUTER_RESOURCE_HANDLER_PROPERTY_NAMES.some((name) =>
            hasActiveRouteProperty(context, node, name),
          )
        ) {
          return;
        }
        context.report({
          node,
          message:
            "This leaf route has no UI and no resource handler, so it renders a null outlet.",
        });
      },
    }),
  }),
);
