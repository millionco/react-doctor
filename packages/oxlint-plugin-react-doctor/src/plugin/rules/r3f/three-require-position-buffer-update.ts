import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  callbackMarksPositionBufferForUpdate,
  findRepeatedPositionBufferMutations,
} from "./utils/find-repeated-position-buffer-mutations.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";

export const threeRequirePositionBufferUpdate = defineRule({
  id: "three-require-position-buffer-update",
  title: "Three.js position buffer is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Set the position BufferAttribute needsUpdate flag after changing its values on the CPU",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        const mutations = findRepeatedPositionBufferMutations(callback, context);
        if (mutations.length === 0 || callbackMarksPositionBufferForUpdate(callback, context)) {
          return;
        }
        for (const mutation of mutations) {
          context.report({
            node: mutation,
            message:
              "This animation loop changes position-buffer data without setting the BufferAttribute needsUpdate flag, so Three.js may keep rendering the previous GPU data",
          });
        }
      },
    };
  },
});
