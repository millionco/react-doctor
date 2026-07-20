import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasActiveRouteProperty } from "../../utils/has-active-route-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterRequireRootErrorBoundary = wrapReactRouterRule(
  defineRule({
    id: "react-router-require-root-error-boundary",
    title: "Root route lacks an error boundary",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Define ErrorBoundary or errorElement on the root route so rendering, loader, and action failures have an application fallback.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        const routeArray = node.parent;
        if (!isNodeOfType(routeArray, "ArrayExpression")) return;
        if (!isNodeOfType(routeArray.parent, "CallExpression")) return;
        if (hasActiveRouteProperty(context, node, "ErrorBoundary")) return;
        if (hasActiveRouteProperty(context, node, "errorElement")) return;
        if (hasActiveRouteProperty(context, node, "lazy")) return;
        context.report({
          node,
          message:
            "This top-level route branch has no error boundary, so failures fall through to React Router's generic default UI.",
        });
      },
    }),
  }),
);
