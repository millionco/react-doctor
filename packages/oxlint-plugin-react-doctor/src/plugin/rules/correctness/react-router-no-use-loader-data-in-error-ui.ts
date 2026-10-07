import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const ROOT_ROUTE_PATTERN = /(?:^|\/)root\.[cm]?[jt]sx?$/;

export const reactRouterNoUseLoaderDataInErrorUi = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-use-loader-data-in-error-ui",
    title: "Error UI assumes loader data exists",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Use useRouteLoaderData with an explicit route ID and handle undefined inside error UI.",
    create: (context: RuleContext) => ({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (
          getImportedNameFromReactRouter(context, node.callee, node.callee.name) !== "useLoaderData"
        ) {
          return;
        }
        const errorUiFunction = findEnclosingFunction(node);
        if (errorUiFunction === null) return;
        const isErrorBoundary = isReactRouterRouteFunction(
          context,
          errorUiFunction,
          "ErrorBoundary",
        );
        const isFrameworkRootLayout =
          hasCapability(context.settings, "react-router-framework") &&
          Boolean(context.filename && ROOT_ROUTE_PATTERN.test(context.filename)) &&
          isReactRouterRouteFunction(context, errorUiFunction, "Layout");
        if (!isErrorBoundary && !isFrameworkRootLayout) {
          return;
        }
        context.report({
          node,
          message:
            "useLoaderData() can be unavailable when this error boundary handles a loader failure.",
        });
      },
    }),
  }),
);
