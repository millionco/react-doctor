import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isGlobalAnimationFrameCallee } from "../../utils/is-global-animation-frame-callee.js";
import { resolveRecursiveAnimationFrameCallback } from "../../utils/resolve-recursive-animation-frame-callback.js";

export const threePreferSetAnimationLoop = defineRule({
  id: "three-prefer-set-animation-loop",
  title: "Three.js renderer uses manual animation frames",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Use renderer.setAnimationLoop for Three.js animation-loop compatibility, including WebXR",
  create: (context) => {
    const reportedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node) {
        if (!isGlobalAnimationFrameCallee(node.callee, context.scopes)) return;
        const callback = resolveRecursiveAnimationFrameCallback(node, context.scopes, {
          requireUnconditionalSchedule: true,
        });
        if (!callback || reportedCallbacks.has(callback)) return;
        reportedCallbacks.add(callback);
        context.report({
          node,
          message:
            "This continuous Three.js animation loop is driven by requestAnimationFrame. Use renderer.setAnimationLoop(callback) for renderer-managed timing and compatibility",
        });
      },
    };
  },
});
