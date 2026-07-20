import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveRemotionApi } from "../../utils/resolve-remotion-api.js";

const isUseStateLazyInitializer = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction) return false;
  const parent = enclosingFunction.parent;
  return Boolean(
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === enclosingFunction &&
    isReactApiCall(parent, "useState", scopes, { resolveNamedAliases: true }),
  );
};

export const remotionStableDelayRenderHandle = defineRule({
  id: "remotion-stable-delay-render-handle",
  title: "delayRender handle is recreated during render",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Prefer `useDelayRender()`, or initialize `delayRender()` once with `useState(() => delayRender())`.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const apiBinding = resolveRemotionApi(node.callee, context.scopes);
      if (
        apiBinding?.apiName !== "delayRender" ||
        apiBinding.moduleSource !== "remotion" ||
        !findRenderPhaseComponentOrHook(node, context.scopes) ||
        isUseStateLazyInitializer(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "Calling `delayRender()` during every component render creates another outstanding handle and can make rendering time out. Use `useDelayRender()` or a lazy `useState` initializer.",
      });
    },
  }),
});
