import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isRouteRequestExpression } from "../../utils/is-route-request-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const REQUEST_BODY_READER_NAMES = new Set([
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
  "json",
  "text",
]);

export const reactRouterNoLoaderRequestBody = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-loader-request-body",
    title: "Loader reads a request body",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Read submitted request bodies in an action; loaders handle GET requests and should use URL search parameters instead.",
    create: (context: RuleContext) => ({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const methodName = getStaticPropertyKeyName(node.callee, { allowComputedString: true });
        if (methodName === null || !REQUEST_BODY_READER_NAMES.has(methodName)) return;
        const loaderFunction = findEnclosingFunction(node);
        if (
          loaderFunction === null ||
          !isReactRouterRouteFunction(context, loaderFunction, "loader")
        )
          return;
        if (!isRouteRequestExpression(context, node.callee.object, loaderFunction)) return;
        context.report({
          node,
          message: `loader reads request.${methodName}(), but loader requests do not carry submitted bodies.`,
        });
      },
    }),
  }),
);
