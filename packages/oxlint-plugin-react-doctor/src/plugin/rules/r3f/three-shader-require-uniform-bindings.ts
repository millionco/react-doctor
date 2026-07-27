import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { THREE_RENDERER_MANAGED_SHADER_UNIFORM_NAMES } from "./constants.js";
import { collectAuthoritativeStaticObjectPropertyNames } from "./utils/collect-authoritative-static-object-property-names.js";
import {
  collectGlslGlobalDeclarations,
  type GlslGlobalDeclaration,
} from "./utils/collect-glsl-global-declarations.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const MANAGED_UNIFORM_FEATURE_BY_NAME: ReadonlyMap<string, string> = new Map([
  ["ambientLightColor", "lights"],
  ["bindMatrix", "skinning"],
  ["bindMatrixInverse", "skinning"],
  ["boneTexture", "skinning"],
  ["boneTextureSize", "skinning"],
  ["clippingPlanes", "clipping"],
  ["directionalLights", "lights"],
  ["directionalLightShadows", "lights"],
  ["directionalShadowMap", "lights"],
  ["directionalShadowMatrix", "lights"],
  ["fogColor", "fog"],
  ["fogDensity", "fog"],
  ["fogFar", "fog"],
  ["fogNear", "fog"],
  ["hemisphereLights", "lights"],
  ["lightProbe", "lights"],
  ["ltc_1", "lights"],
  ["ltc_2", "lights"],
  ["morphTargetBaseInfluence", "morphTargets"],
  ["morphTargetInfluences", "morphTargets"],
  ["morphTargetsTexture", "morphTargets"],
  ["morphTargetsTextureSize", "morphTargets"],
  ["pointLights", "lights"],
  ["pointLightShadows", "lights"],
  ["pointShadowMap", "lights"],
  ["pointShadowMatrix", "lights"],
  ["probesMax", "lights"],
  ["probesMin", "lights"],
  ["probesResolution", "lights"],
  ["probesSH", "lights"],
  ["receiveShadow", "lights"],
  ["rectAreaLights", "lights"],
  ["spotLightMap", "lights"],
  ["spotLightMatrix", "lights"],
  ["spotLights", "lights"],
  ["spotLightShadows", "lights"],
  ["spotShadowMap", "lights"],
  ["transmissionSamplerMap", "transmission"],
  ["transmissionSamplerSize", "transmission"],
]);

const isRendererManagedUniform = (
  uniformName: string,
  material: StaticThreeShaderMaterial,
): boolean => {
  if (
    material.constructorName !== "ShaderMaterial" ||
    !THREE_RENDERER_MANAGED_SHADER_UNIFORM_NAMES.has(uniformName)
  ) {
    return false;
  }
  const requiredFeature = MANAGED_UNIFORM_FEATURE_BY_NAME.get(uniformName);
  if (!requiredFeature) return true;
  const featureExpression = material.properties.get(requiredFeature);
  return featureExpression !== undefined && readStaticBoolean(featureExpression) !== false;
};

const isCustomUniform = (
  declaration: GlslGlobalDeclaration,
  material: StaticThreeShaderMaterial,
): boolean =>
  declaration.qualifiers.has("uniform") &&
  declaration.isStaticallyUsed &&
  !declaration.name.startsWith("gl_") &&
  !isRendererManagedUniform(declaration.name, material);

interface UniformDeclarationSource {
  readonly declaration: GlslGlobalDeclaration;
  readonly shader: StaticThreeShaderStage;
}

export const threeShaderRequireUniformBindings = defineRule({
  id: "three-shader-require-uniform-bindings",
  title: "Shader uniform has no material binding",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Add every custom GLSL uniform to the ShaderMaterial uniforms object with a compatible value",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      const declarationsByName = new Map<string, UniformDeclarationSource>();
      for (const shader of [material.vertexShader, material.fragmentShader]) {
        if (!shader) continue;
        for (const declaration of collectGlslGlobalDeclarations(shader.program)) {
          if (isCustomUniform(declaration, material) && !declarationsByName.has(declaration.name)) {
            declarationsByName.set(declaration.name, { declaration, shader });
          }
        }
      }
      if (declarationsByName.size === 0) return;
      const uniformNames = [...declarationsByName.keys()];
      const uniformsExpression = material.properties.get("uniforms");
      let boundUniformNames: ReadonlySet<string>;
      if (!uniformsExpression) {
        boundUniformNames = new Set();
      } else {
        const uniformsObject = resolveStableOptionsObject(
          uniformsExpression,
          uniformNames,
          context.scopes,
          material.constructorNode,
        );
        if (!uniformsObject || !isNodeOfType(uniformsObject, "ObjectExpression")) return;
        const propertyNames = collectAuthoritativeStaticObjectPropertyNames(uniformsObject);
        if (!propertyNames) return;
        boundUniformNames = propertyNames;
      }
      for (const [uniformName, declarationSource] of declarationsByName) {
        if (boundUniformNames.has(uniformName)) continue;
        context.report({
          node: declarationSource.shader.source.getOriginNodeAtOffset(
            declarationSource.declaration.node.location?.start.offset ?? 0,
          ),
          message: `GLSL uniform ${uniformName} has no matching entry in this material's uniforms object, so it keeps its default value`,
        });
      }
    },
  }),
});
