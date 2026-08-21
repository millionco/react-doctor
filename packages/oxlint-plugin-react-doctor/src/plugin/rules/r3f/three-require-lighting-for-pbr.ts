import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeClosedThreeSceneLighting,
  isThreeSceneRenderCall,
} from "./utils/analyze-closed-three-scene-lighting.js";

export const threeRequireLightingForPbr = defineRule({
  id: "three-require-lighting-for-pbr",
  title: "Three.js PBR material has no lighting source",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Add a light, scene environment, material envMap, lightMap, or intentional emissive source for PBR materials",
  create: (context: RuleContext) => {
    const reportedMaterials = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isThreeSceneRenderCall(node, context)) return;
        const scene = node.arguments[0];
        if (!scene || scene.type === "SpreadElement") return;
        const analysis = analyzeClosedThreeSceneLighting(scene, node, context);
        if (!analysis?.isComplete || analysis.hasEnvironment || analysis.hasLight) return;
        for (const material of analysis.materials) {
          if (
            reportedMaterials.has(material.node) ||
            material.hasEnvironmentMap ||
            material.hasLightMap ||
            material.hasEmissiveSource
          ) {
            continue;
          }
          reportedMaterials.add(material.node);
          context.report({
            node: material.node,
            message: `${material.constructorName} is rendered in a closed scene with no light, environment, envMap, lightMap, or emissive source`,
          });
        }
      },
    };
  },
});
