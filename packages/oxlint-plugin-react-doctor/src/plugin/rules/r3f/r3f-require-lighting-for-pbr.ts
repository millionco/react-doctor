import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { analyzeClosedR3fCanvasLighting } from "./utils/analyze-closed-r3f-canvas-lighting.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";

export const r3fRequireLightingForPbr = defineRule({
  id: "r3f-require-lighting-for-pbr",
  title: "R3F PBR material has no lighting source",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Add a light, scene environment, material envMap, lightMap, or intentional emissive source for PBR materials",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isR3fCanvas(node.openingElement, context)) return;
      const analysis = analyzeClosedR3fCanvasLighting(node, context);
      if (!analysis.isComplete || analysis.hasEnvironment || analysis.hasLight) return;
      for (const material of analysis.materials) {
        if (material.hasEnvironmentMap || material.hasLightMap || material.hasEmissiveSource) {
          continue;
        }
        context.report({
          node: material.node,
          message: `${material.constructorName} is rendered in a closed Canvas with no light, environment, envMap, lightMap, or emissive source`,
        });
      }
    },
  }),
});
