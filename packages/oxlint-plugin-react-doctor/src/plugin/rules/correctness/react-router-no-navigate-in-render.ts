import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { isFunctionInvokedDuringRender } from "../../utils/is-function-invoked-during-render.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoNavigateInRender = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-navigate-in-render",
    title: "navigate() called during render",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "error",
    recommendation:
      "Render <Navigate> for declarative redirects, redirect from a loader or action, or navigate from an event or effect.",
    create: (context: RuleContext) => ({
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;
        if (
          getImportedNameFromReactRouter(context, node.init.callee, node.init.callee.name) !==
          "useNavigate"
        ) {
          return;
        }

        const navigateSymbol = context.scopes.symbolFor(node.id);
        if (navigateSymbol === null) return;

        for (const reference of navigateSymbol.references) {
          const callExpression = reference.identifier.parent;
          if (
            !isNodeOfType(callExpression, "CallExpression") ||
            callExpression.callee !== reference.identifier
          ) {
            continue;
          }
          const enclosingFunction = findEnclosingFunction(callExpression);
          if (
            enclosingFunction === null ||
            !isFunctionInvokedDuringRender(enclosingFunction, context.scopes)
          ) {
            continue;
          }
          context.report({
            node: callExpression,
            message: `${node.id.name}() runs during render and can cause navigation loops or hydration divergence.`,
          });
        }
      },
    }),
  }),
);
