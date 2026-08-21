import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isThreeRendererReference } from "./utils/is-three-renderer-reference.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threeNoSyncReadbackInAnimationLoop = defineRule({
  id: "three-no-sync-readback-in-animation-loop",
  title: "Synchronous GPU readback in Three.js loop",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Use readRenderTargetPixelsAsync or move GPU readback to a discrete, lower-frequency path",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "MemberExpression") ||
            getStaticPropertyName(candidate.callee) !== "readRenderTargetPixels" ||
            !isThreeRendererReference(candidate.callee.object, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "readRenderTargetPixels performs a synchronous GPU-to-CPU transfer inside the animation loop and can stall every frame. Use readRenderTargetPixelsAsync or sample on demand",
          });
        });
      },
    };
  },
});
