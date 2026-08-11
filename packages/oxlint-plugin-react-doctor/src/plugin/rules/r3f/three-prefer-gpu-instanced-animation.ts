import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isInsideRepeatedExecution } from "./utils/is-inside-repeated-execution.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threePreferGpuInstancedAnimation = defineRule({
  id: "three-prefer-gpu-instanced-animation",
  title: "Per-instance CPU transform animation in a Three.js loop",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Move repeated per-instance transform motion into instanced attributes, a vertex shader, or GPU simulation",
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
            getStaticPropertyName(candidate.callee) !== "setMatrixAt" ||
            !isInsideRepeatedExecution(candidate) ||
            getThreeConstructorName(candidate.callee.object, context.scopes) !== "InstancedMesh"
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This animation loop recomputes instance matrices on the CPU every frame. Encode repeated transform motion in instanced attributes, a vertex shader, or GPU simulation",
          });
        });
      },
    };
  },
});
