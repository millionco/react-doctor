import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { isInsideLocalR3fWebgpuComponent } from "./utils/is-inside-local-r3f-webgpu-component.js";
import { isInsideR3fWebgpuCanvas } from "./utils/is-inside-r3f-webgpu-canvas.js";

export const r3fWebgpuNoLegacyEffectComposer = defineRule({
  id: "r3f-webgpu-no-legacy-effect-composer",
  title: "Legacy EffectComposer inside an R3F WebGPU Canvas",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use the renderer's node-based post-processing pipeline instead of @react-three/postprocessing EffectComposer",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isInsideR3fWebgpuCanvas(node, context) &&
        !isInsideLocalR3fWebgpuComponent(node, context)
      ) {
        return;
      }
      const provenance = getApiReferenceProvenance(node.name, context.scopes);
      if (
        provenance?.apiName !== "EffectComposer" ||
        provenance.moduleSource !== "@react-three/postprocessing"
      ) {
        return;
      }
      context.report({
        node,
        message:
          "@react-three/postprocessing EffectComposer targets the legacy WebGL pipeline and cannot render this WebGPU Canvas. Use the node-based render pipeline",
      });
    },
  }),
});
