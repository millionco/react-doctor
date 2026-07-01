import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const describeClientSideNavigation = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "MemberExpression")) {
    const objectName = isNodeOfType(node.callee.object, "Identifier")
      ? node.callee.object.name
      : null;
    const methodName = isNodeOfType(node.callee.property, "Identifier")
      ? node.callee.property.name
      : null;
    if (objectName === "router" && (methodName === "push" || methodName === "replace")) {
      return `router.${methodName}() in useEffect flashes the wrong page before redirecting.`;
    }
  }

  if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
    const objectName = isNodeOfType(node.left.object, "Identifier") ? node.left.object.name : null;
    const propertyName = isNodeOfType(node.left.property, "Identifier")
      ? node.left.property.name
      : null;
    if (objectName === "window" && propertyName === "location") {
      return `window.location assignment in useEffect flashes the wrong page before redirecting.`;
    }
    if (objectName === "location" && propertyName === "href") {
      return `location.href assignment in useEffect flashes the wrong page before redirecting.`;
    }
  }

  return null;
};

// Under `output: "export"` there is no request-time server, so the default
// "use middleware / getServerSideProps" advice is impossible. Keep the
// still-valid client-side + render-time fixes and drop the server-only clause.
const STATIC_EXPORT_RECOMMENDATION =
  'Avoid redirects inside useEffect — they flash the wrong page first. Use an event handler (e.g. onClick), or call redirect() from next/navigation during render (it prerenders a client-side redirect under output: "export"). Middleware and getServerSideProps redirects aren\'t available in a static export.';

export const nextjsNoClientSideRedirect = defineRule({
  id: "nextjs-no-client-side-redirect",
  title: "Client-side redirect for navigation",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Avoid redirects inside useEffect. Use an event handler, middleware, or server-side redirect (App Router: redirect() from next/navigation; Pages Router: getServerSideProps redirect)",
  recommendationFor: (hasCapability) =>
    hasCapability("nextjs:static-export") ? STATIC_EXPORT_RECOMMENDATION : undefined,
  create: (context: RuleContext) => {
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
        walkAst(callback, (child: EsTreeNode) => {
          // Stop at non-invoked nested function boundaries: a navigation inside
          // an event handler registered in the effect runs on a later user
          // interaction, not as part of the mount-time effect, so it must not
          // be flagged — but IIFEs, called local functions, and promise-chain
          // callbacks of effect-body calls do run on mount.
          if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child)) {
            return false;
          }

          const navigationDescription = describeClientSideNavigation(child);
          if (navigationDescription) {
            context.report({
              node: child,
              message: navigationDescription,
            });
          }
        });
      },
    };
  },
});
