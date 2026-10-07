import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";

export const threeNoAsyncAnimationLoop = defineRule({
  id: "three-no-async-animation-loop",
  title: "Async Three.js animation callback",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Keep animation callbacks synchronous; start asynchronous work outside the loop and consume completed state during frames",
  create: (context: RuleContext) => {
    const reportedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!isFunctionLike(callback) || !callback.async || reportedCallbacks.has(callback)) return;
        reportedCallbacks.add(callback);
        context.report({
          node: callback,
          message:
            "The animation scheduler ignores this Promise, so rejected work can become unhandled and awaited work can overlap across frames. Keep the callback synchronous",
        });
      },
    };
  },
});
