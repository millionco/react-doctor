import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoInvalidSplatPath = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-invalid-splat-path",
    title: "Invalid splat route path",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "error",
    recommendation: "Use '*' for a catch-all route or end a path with '/*'.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        const pathProperty = getStaticRouteProperty(node, "path");
        if (pathProperty === null) return;
        const routePath = getStaticStringExpression(pathProperty.value);
        if (routePath === null || !routePath.includes("*")) return;
        if (routePath === "*" || routePath.endsWith("/*")) return;
        context.report({
          node: pathProperty,
          message: `Route path '${routePath}' uses a splat that is not a complete trailing segment.`,
        });
      },
    }),
  }),
);
