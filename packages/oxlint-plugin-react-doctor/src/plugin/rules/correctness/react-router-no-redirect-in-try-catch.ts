import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const REDIRECT_ROUTE_FUNCTION_NAMES = ["action", "clientAction", "clientLoader", "loader"];

export const reactRouterNoRedirectInTryCatch = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-redirect-in-try-catch",
    title: "redirect() inside try-catch",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Move redirect outside the guarded try block or rethrow redirect responses from catch.",
    create: (context: RuleContext) => ({
      ThrowStatement(node: EsTreeNodeOfType<"ThrowStatement">) {
        if (!isNodeOfType(node.argument, "CallExpression")) return;
        if (!isNodeOfType(node.argument.callee, "Identifier")) return;
        const importedName = getImportedNameFromReactRouter(
          context,
          node.argument.callee,
          node.argument.callee.name,
        );
        if (importedName !== "redirect" && importedName !== "redirectDocument") return;
        const routeFunction = findEnclosingFunction(node);
        if (
          routeFunction === null ||
          !REDIRECT_ROUTE_FUNCTION_NAMES.some((name) =>
            isReactRouterRouteFunction(context, routeFunction, name),
          )
        ) {
          return;
        }
        if (findGuardingTryStatement(node) === null) return;
        context.report({
          node,
          message: `throw ${node.argument.callee.name}() is guarded by a catch block that can swallow the redirect response.`,
        });
      },
    }),
  }),
);
