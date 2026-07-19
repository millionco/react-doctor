import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const findRouteConfigCall = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (isNodeOfType(current, "CallExpression")) return current;
    current = current.parent;
  }
  return null;
};

export const reactRouterNoDuplicateRouteId = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-duplicate-route-id",
    title: "Duplicate route ID",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation: "Give every explicit route ID a unique value within the router.",
    create: (context: RuleContext) => {
      const idsByRouteConfig = new Map<EsTreeNode, Set<string>>();
      return {
        ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
          if (!isStaticReactRouterRouteObject(context, node)) return;
          const idProperty = getStaticRouteProperty(node, "id");
          if (idProperty === null) return;
          const routeId = getStaticStringExpression(idProperty.value);
          if (routeId === null) return;
          const routeConfigCall = findRouteConfigCall(node);
          if (routeConfigCall === null) return;
          const seenIds = idsByRouteConfig.get(routeConfigCall) ?? new Set<string>();
          if (seenIds.has(routeId)) {
            context.report({
              node: idProperty,
              message: `Route ID '${routeId}' is already used by another route in this router.`,
            });
          }
          seenIds.add(routeId);
          idsByRouteConfig.set(routeConfigCall, seenIds);
        },
      };
    },
  }),
);
