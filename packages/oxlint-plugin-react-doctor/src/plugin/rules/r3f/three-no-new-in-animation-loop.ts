import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threeNoNewInAnimationLoop = defineRule({
  id: "three-no-new-in-animation-loop",
  title: "Allocation inside Three.js animation loop",
  severity: "warn",
  recommendation:
    "Allocate reusable objects before the animation loop and mutate them in place during each frame",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (candidate.type !== "NewExpression" || isConditionallyExecuted) return;
          context.report({
            node: candidate,
            message:
              "This constructor allocates a new object every executed frame. Reuse an object allocated outside the Three.js animation loop",
          });
        });
      },
    };
  },
});
