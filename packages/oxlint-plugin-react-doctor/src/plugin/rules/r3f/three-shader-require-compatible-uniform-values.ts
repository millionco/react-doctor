import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../utils/get-effective-object-properties-in-insertion-order.js";
import { getStaticArrayLikeLength } from "../../utils/get-static-array-like-length.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { GLSL_FLAT_VALUE_COUNT_BY_TYPE_NAME } from "./constants.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { resolveStaticShaderUniformsObject } from "./utils/resolve-static-shader-uniforms-object.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";
import { resolveStaticThreeUniformValue } from "./utils/resolve-static-three-uniform-value.js";

const FLOAT_SCALAR_TYPE_NAMES: ReadonlySet<string> = new Set(["double", "float"]);
const INTEGER_SCALAR_TYPE_NAMES: ReadonlySet<string> = new Set(["int", "uint"]);
const TEXTURE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "CanvasTexture",
  "CompressedArrayTexture",
  "CompressedCubeTexture",
  "CompressedTexture",
  "CubeTexture",
  "Data3DTexture",
  "DataArrayTexture",
  "DataTexture",
  "DepthTexture",
  "FramebufferTexture",
  "Texture",
  "VideoFrameTexture",
  "VideoTexture",
]);

const getRequiredVectorConstructorName = (typeName: string): string | null => {
  const match = /^[biu]?vec([234])$/.exec(typeName);
  return match ? `Vector${match[1]}` : null;
};

const isCompatibleSamplerValue = (typeName: string, constructorName: string): boolean => {
  if (typeName.endsWith("Shadow")) return constructorName === "DepthTexture";
  if (typeName.includes("Cube")) return constructorName === "CubeTexture";
  if (typeName.includes("2DArray")) {
    return constructorName === "DataArrayTexture" || constructorName === "CompressedArrayTexture";
  }
  if (typeName.includes("3D")) return constructorName === "Data3DTexture";
  return TEXTURE_CONSTRUCTOR_NAMES.has(constructorName);
};

const isProvablyCompatibleUniformValue = (
  typeName: string,
  value: EsTreeNode,
  context: RuleContext,
): boolean | null => {
  const candidate = stripParenExpression(value);
  if (isNodeOfType(candidate, "Literal")) {
    if (candidate.value === null) return null;
    if (FLOAT_SCALAR_TYPE_NAMES.has(typeName) || INTEGER_SCALAR_TYPE_NAMES.has(typeName)) {
      return typeof candidate.value === "number";
    }
    if (typeName === "bool") return typeof candidate.value === "boolean";
    return false;
  }
  const expectedFlatValueCount = GLSL_FLAT_VALUE_COUNT_BY_TYPE_NAME.get(typeName);
  const staticArrayLength = getStaticArrayLikeLength(candidate, context.scopes);
  if (staticArrayLength !== null) {
    return expectedFlatValueCount === undefined
      ? false
      : staticArrayLength === expectedFlatValueCount;
  }
  const constructorName = getThreeConstructorName(candidate, context.scopes);
  if (!constructorName) return null;
  if (/^[iu]?sampler/.test(typeName)) {
    return isCompatibleSamplerValue(typeName, constructorName);
  }
  const expectedVectorConstructorName = getRequiredVectorConstructorName(typeName);
  if (expectedVectorConstructorName) {
    return (
      constructorName === expectedVectorConstructorName ||
      (typeName === "vec3" && constructorName === "Color")
    );
  }
  if (typeName === "mat3") return constructorName === "Matrix3";
  if (typeName === "mat4") return constructorName === "Matrix4";
  if (
    FLOAT_SCALAR_TYPE_NAMES.has(typeName) ||
    INTEGER_SCALAR_TYPE_NAMES.has(typeName) ||
    typeName === "bool"
  ) {
    return false;
  }
  return null;
};

export const threeShaderRequireCompatibleUniformValues = defineRule({
  id: "three-shader-require-compatible-uniform-values",
  title: "Shader uniform value has an incompatible JavaScript shape",
  category: "Correctness",
  severity: "error",
  recommendation: "Bind GLSL uniforms to compatible numbers, vectors, matrices, and textures",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      const uniformsExpression = material?.properties.get("uniforms");
      if (!material || !uniformsExpression) return;
      const declarationsByName = new Map<string, string>();
      for (const shader of [material.vertexShader, material.fragmentShader]) {
        if (!shader) continue;
        for (const declaration of collectGlslGlobalDeclarations(shader.program)) {
          if (
            declaration.qualifiers.has("uniform") &&
            declaration.arraySize === null &&
            !declarationsByName.has(declaration.name)
          ) {
            declarationsByName.set(declaration.name, declaration.typeName);
          }
        }
      }
      const uniformsObject = resolveStaticShaderUniformsObject(
        uniformsExpression,
        material.constructorNode,
        context,
      );
      const properties = uniformsObject
        ? getEffectiveObjectPropertiesInInsertionOrder(uniformsObject.properties)
        : null;
      if (!properties) return;
      for (const property of properties) {
        const uniformName = getStaticPropertyKeyName(property, { allowComputedString: true });
        const typeName = uniformName ? declarationsByName.get(uniformName) : undefined;
        if (!typeName || property.kind !== "init" || property.method) continue;
        const uniformValue = resolveStaticThreeUniformValue(
          property.value,
          material.constructorNode,
          context,
        );
        if (
          !uniformValue?.expression ||
          isProvablyCompatibleUniformValue(typeName, uniformValue.expression, context) !== false
        ) {
          continue;
        }
        context.report({
          node: uniformValue.expression,
          message: `Uniform ${uniformName} is declared as ${typeName}, but its static JavaScript value has an incompatible shape`,
        });
      }
    },
  }),
});
