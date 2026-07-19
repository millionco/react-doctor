import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const EXCLUSIVE_ROUTE_PROPERTY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["Component", "element"],
  ["ErrorBoundary", "errorElement"],
  ["HydrateFallback", "hydrateFallbackElement"],
];

export const reactRouterValidRouteObject = wrapReactRouterRule(
  defineRule({
    id: "react-router-valid-route-object",
    title: "Contradictory route object",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Remove incompatible route properties so each route has one unambiguous rendering contract.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        const indexProperty = getStaticRouteProperty(node, "index");
        if (
          indexProperty !== null &&
          isNodeOfType(indexProperty.value, "Literal") &&
          indexProperty.value.value === true
        ) {
          const incompatibleProperty =
            getStaticRouteProperty(node, "children") ?? getStaticRouteProperty(node, "path");
          if (incompatibleProperty !== null) {
            context.report({
              node: incompatibleProperty,
              message: "An index route cannot also declare children or a path.",
            });
          }
        }
        for (const [componentPropertyName, elementPropertyName] of EXCLUSIVE_ROUTE_PROPERTY_PAIRS) {
          if (
            getStaticRouteProperty(node, componentPropertyName) === null ||
            getStaticRouteProperty(node, elementPropertyName) === null
          ) {
            continue;
          }
          context.report({
            node,
            message: `Route declares both ${componentPropertyName} and ${elementPropertyName}; only one is used.`,
          });
        }
      },
    }),
  }),
);
