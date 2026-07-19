import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideLocalR3fWebgpuComponent } from "./utils/is-inside-local-r3f-webgpu-component.js";
import { isInsideR3fWebgpuCanvas } from "./utils/is-inside-r3f-webgpu-canvas.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

const LEGACY_SHADER_MATERIAL_HOST_NAMES: ReadonlySet<string> = new Set([
  "rawShaderMaterial",
  "shaderMaterial",
]);

export const r3fWebgpuNoLegacyMaterialApi = defineRule({
  id: "r3f-webgpu-no-legacy-material-api",
  title: "Legacy shader material API inside an R3F WebGPU Canvas",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use Three.js node materials and TSL for custom shaders rendered by the WebGPU backend",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isR3fHostIntrinsic(node) ||
        (!isInsideR3fWebgpuCanvas(node, context) && !isInsideLocalR3fWebgpuComponent(node, context))
      ) {
        return;
      }
      const elementType = resolveJsxElementType(node);
      if (elementType && LEGACY_SHADER_MATERIAL_HOST_NAMES.has(elementType)) {
        context.report({
          node,
          message:
            "ShaderMaterial and RawShaderMaterial do not run on Three.js WebGPURenderer. Build this shader with a node material and TSL",
        });
        return;
      }
      if (!elementType?.endsWith("Material")) return;
      const onBeforeCompileAttribute = getAuthoritativeJsxAttribute(
        node.attributes,
        "onBeforeCompile",
      );
      if (!onBeforeCompileAttribute) return;
      context.report({
        node: onBeforeCompileAttribute,
        message:
          "onBeforeCompile patches WebGL shader source and is not supported by Three.js WebGPURenderer. Use a node material and TSL",
      });
    },
  }),
});
