import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findRepeatedPositionBufferMutations } from "./utils/find-repeated-position-buffer-mutations.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";

export const threePreferGpuPositionAnimation = defineRule({
  id: "three-prefer-gpu-position-animation",
  title: "Per-vertex CPU animation in a Three.js frame loop",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Animate repeated vertex or particle positions in a vertex shader, instanced attribute, or GPU simulation instead of rewriting them on the CPU every frame",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        const firstMutation = findRepeatedPositionBufferMutations(callback, context)[0];
        if (!firstMutation) return;
        context.report({
          node: firstMutation,
          message:
            "This animation loop rewrites position-buffer entries on the CPU. Move repeated vertex or particle motion into a vertex shader, instanced attributes, or a GPU simulation",
        });
      },
    };
  },
});
