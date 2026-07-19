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
    "Create the handle once inside the component. Use `useDelayRender()` on Remotion 4.0.342 or newer, or lazy `useState(() => delayRender())` on earlier versions.",
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
          "A module-scoped `delayRender()` handle blocks all compositions and composition discovery. Move it inside the component and create it once with `useDelayRender()` or a lazy `useState` initializer.",
      });
    },
  }),
});
