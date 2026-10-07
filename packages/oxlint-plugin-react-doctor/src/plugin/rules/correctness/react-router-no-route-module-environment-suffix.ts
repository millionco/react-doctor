import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const ROUTE_MODULE_ENVIRONMENT_PATTERN = /(?:^|\/)routes\/[^/]+\.(?:client|server)\.[cm]?[jt]sx?$/;

export const reactRouterNoRouteModuleEnvironmentSuffix = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-route-module-environment-suffix",
    title: "Route module has an environment suffix",
    tags: ["migration-hint"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    recommendation:
      "Keep the route module environment-neutral and move environment-specific code into imported .client or .server modules.",
    create: (context: RuleContext) => ({
      Program(node: EsTreeNodeOfType<"Program">) {
        const filename = context.filename;
        if (!filename || !ROUTE_MODULE_ENVIRONMENT_PATTERN.test(filename)) return;
        const hasRouteExport = findExportedValue(node, "default") !== null;
        if (!hasRouteExport) return;
        context.report({
          node,
          message:
            "A Framework route module must participate in both client and server module graphs.",
        });
      },
    }),
  }),
);
