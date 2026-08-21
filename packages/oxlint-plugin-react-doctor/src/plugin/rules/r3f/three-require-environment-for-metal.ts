import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { METAL_ENVIRONMENT_THRESHOLD } from "./constants.js";
import {
  analyzeClosedThreeSceneLighting,
  isThreeSceneRenderCall,
} from "./utils/analyze-closed-three-scene-lighting.js";

export const threeRequireEnvironmentForMetal = defineRule({
  id: "three-require-environment-for-metal",
  title: "Metal Three.js material has no environment",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Provide scene environment lighting or an envMap for strongly metallic standard and physical materials",
  create: (context: RuleContext) => {
    const reportedMaterials = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isThreeSceneRenderCall(node, context)) return;
        const scene = node.arguments[0];
        if (!scene || scene.type === "SpreadElement") return;
        const analysis = analyzeClosedThreeSceneLighting(scene, node, context);
        if (!analysis?.isComplete || analysis.hasEnvironment) return;
        for (const material of analysis.materials) {
          if (
            reportedMaterials.has(material.node) ||
            material.hasEnvironmentMap ||
            material.metalness === null ||
            material.metalness <= METAL_ENVIRONMENT_THRESHOLD
          ) {
            continue;
          }
          reportedMaterials.add(material.node);
          context.report({
            node: material.node,
            message: `${material.constructorName} uses metalness ${String(material.metalness)} without an envMap or rendered scene environment, so its reflections have no environment source`,
          });
        }
      },
    };
  },
});
