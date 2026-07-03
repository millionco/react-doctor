import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoUseEffectFetch = defineRule({
  id: "tanstack-start-no-useeffect-fetch",
  title: "fetch inside useEffect in route",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Fetch data in the route `loader` instead. The router loads it before rendering and avoids waterfalls.",
  create: (context: RuleContext): RuleVisitors => {
    if (!isInProjectDirectory(context, "routes")) return {};
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

        const callback = node.arguments?.[0];
        if (!callback) return;

        let hasFetchCall = false;
        const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
        walkAst(callback, (child: EsTreeNode) => {
          if (hasFetchCall) return false;
          // Skip nested handlers (addEventListener / setInterval) — a fetch
          // there fires on an external event, not as a render-time data fetch
          // the route loader could replace — but keep walking into functions
          // the effect body itself invokes (IIFEs, called local functions,
          // promise-chain callbacks): those ARE the render-time fetch.
          if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child))
            return false;
          if (
            isNodeOfType(child, "CallExpression") &&
            isNodeOfType(child.callee, "Identifier") &&
            child.callee.name === "fetch"
          ) {
            hasFetchCall = true;
          }
        });

        if (hasFetchCall) {
          context.report({
            node,
            message:
              "fetch() inside useEffect makes your users wait through a loading spinner after render.",
          });
        }
      },
    };
  },
});
