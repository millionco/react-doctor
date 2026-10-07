import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { programConstructsThreeWebgpuRenderer } from "./utils/program-constructs-three-webgpu-renderer.js";

export const threeWebgpuNoLegacyEffectComposer = defineRule({
  id: "three-webgpu-no-legacy-effect-composer",
  title: "Legacy EffectComposer used with WebGPURenderer",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use WebGPURenderer's node-based post-processing pipeline instead of the legacy WebGL EffectComposer",
  create: (context: RuleContext) => {
    let constructsWebgpuRenderer = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        constructsWebgpuRenderer = programConstructsThreeWebgpuRenderer(node, context.scopes);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (
          !constructsWebgpuRenderer ||
          getThreeConstructorName(node, context.scopes) !== "EffectComposer"
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Legacy EffectComposer does not support Three.js WebGPURenderer. Build post-processing with the renderer's node-based pipeline",
        });
      },
    };
  },
});
