import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { resolveRemotionApi } from "../../utils/resolve-remotion-api.js";

export const remotionNoModuleScopeDelayRender = defineRule({
  id: "remotion-no-module-scope-delay-render",
  title: "Module-scoped delayRender blocks every composition",
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Call `useDelayRender()` inside the component that owns the asynchronous work instead of blocking from module scope.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const apiBinding = resolveRemotionApi(node.callee, context.scopes);
      if (
        apiBinding?.apiName !== "delayRender" ||
        apiBinding.moduleSource !== "remotion" ||
        findEnclosingFunction(node)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "A module-scoped `delayRender()` handle blocks all compositions and composition discovery. Create the handle inside the component with `useDelayRender()` instead.",
      });
    },
  }),
});
