import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isInsideStableR3fReactHookInitializer } from "./utils/is-inside-stable-r3f-react-hook-initializer.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";
import { resolveR3fFreshValue } from "./utils/resolve-r3f-fresh-value.js";

const FRESH_PORTAL_CONTAINER_KINDS = new Set(["instance", "clone"]);

const isStableHookValue = (node: EsTreeNode, context: RuleContext): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  const hookCall = expressionRoot.parent;
  return Boolean(
    isNodeOfType(hookCall, "CallExpression") &&
    hookCall.arguments[0] === expressionRoot &&
    (isR3fReactApiCall(hookCall, "useRef", context.scopes, {
      allowGlobalReactNamespace: true,
    }) ||
      isR3fReactApiCall(hookCall, "useState", context.scopes, {
        allowGlobalReactNamespace: true,
      })),
  );
};

export const r3fNoFreshPortalContainer = defineRule({
  id: "r3f-no-fresh-portal-container",
  title: "Fresh R3F portal container",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Keep the createPortal container stable with module scope, lazy state, or useMemo so R3F can preserve the portal store and event layer",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isR3fApiCall(node, "createPortal", context.scopes) ||
        !findRenderPhaseComponentOrHook(node, context.scopes) ||
        isStableHookValue(node, context) ||
        isInsideStableR3fReactHookInitializer(node, context.scopes)
      ) {
        return;
      }
      const containerArgument = node.arguments[1];
      if (!containerArgument || isNodeOfType(containerArgument, "SpreadElement")) return;
      const freshKind = resolveR3fFreshValue(
        containerArgument,
        context.scopes,
        FRESH_PORTAL_CONTAINER_KINDS,
      );
      if (!freshKind) return;
      context.report({
        node: containerArgument,
        message: `This ${freshKind} gives createPortal a different container on every render, forcing R3F to rebuild or remount portal state and event handling. Reuse a stable container`,
      });
    },
  }),
});
