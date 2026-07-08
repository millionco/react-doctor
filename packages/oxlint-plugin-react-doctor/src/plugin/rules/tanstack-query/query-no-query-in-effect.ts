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

export const queryNoQueryInEffect = defineRule({
  id: "query-no-query-in-effect",
  title: "Query refetch inside useEffect",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `queryKey` changes or `enabled` so React Query schedules the fetch once instead of refetching again from `useEffect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
      walkAst(callback, (child: EsTreeNode) => {
        // Skip calls registered inside nested handlers (addEventListener /
        // setInterval) — those fire on an external event — but keep walking
        // into functions the effect body itself invokes (IIFEs, called local
        // functions, promise-chain callbacks): those run on every effect
        // execution.
        if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child))
          return false;
        if (!isNodeOfType(child, "CallExpression")) return;

        const callee = child.callee;
        const isRefetchCall =
          (isNodeOfType(callee, "Identifier") && callee.name === "refetch") ||
          (isNodeOfType(callee, "MemberExpression") &&
            !callee.computed &&
            isNodeOfType(callee.property, "Identifier") &&
            callee.property.name === "refetch");

        if (isRefetchCall) {
          context.report({
            node: child,
            message:
              "refetch() inside useEffect duplicates work React Query already does, causing extra fetches.",
          });
        }
      });
    },
  }),
});
