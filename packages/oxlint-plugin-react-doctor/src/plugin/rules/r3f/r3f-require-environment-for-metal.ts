import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { METAL_ENVIRONMENT_THRESHOLD } from "./constants.js";
import { analyzeClosedR3fCanvasLighting } from "./utils/analyze-closed-r3f-canvas-lighting.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";

export const r3fRequireEnvironmentForMetal = defineRule({
  id: "r3f-require-environment-for-metal",
  title: "Metal R3F material has no environment",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Provide scene environment lighting or an envMap for strongly metallic standard and physical materials",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isR3fCanvas(node.openingElement, context)) return;
      const analysis = analyzeClosedR3fCanvasLighting(node, context);
      if (!analysis.isComplete || analysis.hasEnvironment) return;
      for (const material of analysis.materials) {
        if (
          material.hasEnvironmentMap ||
          material.metalness === null ||
          material.metalness <= METAL_ENVIRONMENT_THRESHOLD
        ) {
          continue;
        }
        context.report({
          node: material.node,
          message: `${material.constructorName} uses metalness ${String(material.metalness)} without an envMap or Canvas scene environment, so its reflections have no environment source`,
        });
      }
    },
  }),
});
