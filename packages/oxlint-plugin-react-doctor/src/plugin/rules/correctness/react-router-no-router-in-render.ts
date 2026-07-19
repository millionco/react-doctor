import { REACT_ROUTER_FACTORY_EXPORT_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoRouterInRender = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-router-in-render",
    title: "Router created during render",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Create the router at module scope so navigation state and subscriptions survive renders.",
    create: (context: RuleContext) => ({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const importedName = getImportedNameFromReactRouter(context, node.callee, node.callee.name);
        if (importedName === null || !REACT_ROUTER_FACTORY_EXPORT_NAMES.has(importedName)) return;
        if (findRenderPhaseComponentOrHook(node, context.scopes) === null) return;
        context.report({
          node,
          message: `${node.callee.name}() creates a new router during render and resets router state.`,
        });
      },
    }),
  }),
);
