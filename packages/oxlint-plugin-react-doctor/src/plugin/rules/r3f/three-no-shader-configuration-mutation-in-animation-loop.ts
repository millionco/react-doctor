import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getShaderConfigurationMutationReceiver } from "./utils/get-shader-configuration-mutation-receiver.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const SHADER_MATERIAL_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "RawShaderMaterial",
  "ShaderMaterial",
]);

export const threeNoShaderConfigurationMutationInAnimationLoop = defineRule({
  id: "three-no-shader-configuration-mutation-in-animation-loop",
  title: "Shader configuration mutates every animation frame",
  category: "Performance",
  severity: "error",
  recommendation:
    "Keep shader source and program configuration stable; animate existing uniform values instead",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (isConditionallyExecuted || !isNodeOfType(candidate, "AssignmentExpression")) return;
          const receiver = getShaderConfigurationMutationReceiver(candidate);
          if (
            !receiver ||
            !SHADER_MATERIAL_CONSTRUCTOR_NAMES.has(
              getThreeConstructorName(receiver, context.scopes) ?? "",
            )
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This animation loop rewrites ShaderMaterial program configuration every frame. Keep it stable and update existing uniform values for animation",
          });
        });
      },
    };
  },
});
