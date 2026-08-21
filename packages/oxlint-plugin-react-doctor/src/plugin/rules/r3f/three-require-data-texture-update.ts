import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findDataTextureMutationsWithoutUpdate } from "./utils/find-data-texture-mutations-without-update.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";

export const threeRequireDataTextureUpdate = defineRule({
  id: "three-require-data-texture-update",
  title: "Changed data texture is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation: "Set texture.needsUpdate to true after changing data-texture pixels",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        for (const mutation of findDataTextureMutationsWithoutUpdate(callback, context)) {
          context.report({
            node: mutation,
            message:
              "This animation loop changes data-texture pixels without setting texture.needsUpdate on every path, so the GPU can keep rendering stale texels",
          });
        }
      },
    };
  },
});
