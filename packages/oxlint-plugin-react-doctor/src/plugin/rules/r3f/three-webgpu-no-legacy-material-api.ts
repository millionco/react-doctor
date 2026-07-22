import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { programConstructsThreeWebgpuRenderer } from "./utils/program-constructs-three-webgpu-renderer.js";

const LEGACY_SHADER_MATERIAL_NAMES: ReadonlySet<string> = new Set([
  "RawShaderMaterial",
  "ShaderMaterial",
]);

export const threeWebgpuNoLegacyMaterialApi = defineRule({
  id: "three-webgpu-no-legacy-material-api",
  title: "Legacy material API used with WebGPURenderer",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use Three.js node materials and TSL for custom shaders rendered by WebGPURenderer",
  create: (context: RuleContext) => {
    let constructsWebgpuRenderer = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        constructsWebgpuRenderer = programConstructsThreeWebgpuRenderer(node, context.scopes);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        const constructorName = getThreeConstructorName(node, context.scopes);
        if (!constructsWebgpuRenderer || !constructorName) return;
        if (!LEGACY_SHADER_MATERIAL_NAMES.has(constructorName)) return;
        context.report({
          node,
          message:
            "ShaderMaterial and RawShaderMaterial are not supported by Three.js WebGPURenderer. Build this shader with a node material and TSL",
        });
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (
          !constructsWebgpuRenderer ||
          !isNodeOfType(node.left, "MemberExpression") ||
          getStaticPropertyName(node.left) !== "onBeforeCompile"
        ) {
          return;
        }
        const constructorName = getThreeConstructorName(node.left.object, context.scopes);
        if (!constructorName?.endsWith("Material")) return;
        context.report({
          node,
          message:
            "onBeforeCompile patches WebGL shader source and is not supported by Three.js WebGPURenderer. Use a node material and TSL",
        });
      },
    };
  },
});
