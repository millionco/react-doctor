import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  THREE_SHADER_MATERIAL_INJECTED_FRAGMENT_NAMES,
  THREE_SHADER_MATERIAL_INJECTED_VERTEX_NAMES,
} from "./constants.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const checkShader = (
  shader: StaticThreeShaderStage,
  injectedNames: ReadonlySet<string>,
  context: RuleContext,
): void => {
  for (const declaration of collectGlslGlobalDeclarations(shader.program)) {
    if (!injectedNames.has(declaration.name)) continue;
    context.report({
      node: shader.source.getOriginNodeAtOffset(declaration.node.location?.start.offset ?? 0),
      message: `ShaderMaterial already injects ${declaration.name} into the ${shader.stage} shader, so this declaration collides with Three.js's generated prefix`,
    });
  }
};

export const threeShaderNoRedeclaredBuiltins = defineRule({
  id: "three-shader-no-redeclared-builtins",
  title: "ShaderMaterial redeclares a Three.js builtin",
  category: "Correctness",
  severity: "error",
  recommendation: "Use ShaderMaterial built-in attributes and uniforms without redeclaring them",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (material?.constructorName !== "ShaderMaterial") return;
      if (material.vertexShader) {
        checkShader(material.vertexShader, THREE_SHADER_MATERIAL_INJECTED_VERTEX_NAMES, context);
      }
      if (material.fragmentShader) {
        checkShader(
          material.fragmentShader,
          THREE_SHADER_MATERIAL_INJECTED_FRAGMENT_NAMES,
          context,
        );
      }
    },
  }),
});
