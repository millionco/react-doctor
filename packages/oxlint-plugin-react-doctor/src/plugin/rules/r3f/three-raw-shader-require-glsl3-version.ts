import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import { readThreeGlslVersion } from "./utils/read-three-glsl-version.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const GLSL3_ONLY_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "acosh",
  "asinh",
  "atanh",
  "bitCount",
  "bitfieldExtract",
  "bitfieldInsert",
  "bitfieldReverse",
  "cosh",
  "determinant",
  "findLSB",
  "findMSB",
  "floatBitsToInt",
  "floatBitsToUint",
  "frexp",
  "imulExtended",
  "intBitsToFloat",
  "interpolateAtCentroid",
  "interpolateAtOffset",
  "interpolateAtSample",
  "inverse",
  "isinf",
  "isnan",
  "ldexp",
  "modf",
  "outerProduct",
  "packHalf2x16",
  "packSnorm2x16",
  "packUnorm2x16",
  "round",
  "roundEven",
  "sinh",
  "tanh",
  "texelFetch",
  "texelFetchOffset",
  "texture",
  "textureGrad",
  "textureGradOffset",
  "textureLod",
  "textureLodOffset",
  "textureOffset",
  "textureProj",
  "textureProjGrad",
  "textureProjGradOffset",
  "textureProjLod",
  "textureProjLodOffset",
  "textureProjOffset",
  "textureSize",
  "transpose",
  "trunc",
  "uaddCarry",
  "uintBitsToFloat",
  "umulExtended",
  "unpackHalf2x16",
  "unpackSnorm2x16",
  "unpackUnorm2x16",
  "usubBorrow",
]);
const GLSL3_ONLY_TYPE_NAME_PATTERN =
  /^(?:uint|uvec[234]|mat[234]x[234]|sampler3D|sampler2DArray|[iu]sampler(?:2D|3D|Cube|2DArray))$/;
const GLSL3_ONLY_CONSTRUCTOR_NAME_PATTERN = /^(?:uint|uvec[234]|mat[234]x[234])$/;

const shaderUsesGlsl3Syntax = (shader: StaticThreeShaderStage): boolean => {
  if (
    collectGlslGlobalDeclarations(shader.program).some(
      (declaration) =>
        declaration.hasLayoutQualifier ||
        declaration.qualifiers.has("in") ||
        declaration.qualifiers.has("out") ||
        GLSL3_ONLY_TYPE_NAME_PATTERN.test(declaration.typeName),
    )
  ) {
    return true;
  }
  let usesGlsl3Syntax = false;
  visit(shader.program, {
    binary: {
      enter: ({ node }) => {
        if (
          node.operator.literal === "<<" ||
          node.operator.literal === ">>" ||
          node.operator.literal === "&" ||
          node.operator.literal === "|" ||
          node.operator.literal === "^"
        ) {
          usesGlsl3Syntax = true;
        }
      },
    },
    assignment: {
      enter: ({ node }) => {
        const operatorLiteral = String(node.operator.literal);
        if (
          operatorLiteral === "<<=" ||
          operatorLiteral === ">>=" ||
          operatorLiteral === "&=" ||
          operatorLiteral === "|=" ||
          operatorLiteral === "^="
        ) {
          usesGlsl3Syntax = true;
        }
      },
    },
    function_call: {
      enter: ({ node }) => {
        const functionName = getGlslFunctionCallName(node);
        if (
          functionName &&
          (GLSL3_ONLY_FUNCTION_NAMES.has(functionName) ||
            GLSL3_ONLY_CONSTRUCTOR_NAME_PATTERN.test(functionName)) &&
          !hasGlslFunctionLikeMacro(shader.source.text, functionName) &&
          !hasGlslFunctionDeclaration(shader.program, functionName)
        ) {
          usesGlsl3Syntax = true;
        }
      },
    },
    switch_statement: {
      enter: () => {
        usesGlsl3Syntax = true;
      },
    },
  });
  return usesGlsl3Syntax;
};

export const threeRawShaderRequireGlsl3Version = defineRule({
  id: "three-raw-shader-require-glsl3-version",
  title: "Raw shader uses GLSL 3 syntax without GLSL3",
  category: "Correctness",
  severity: "error",
  recommendation: "Set glslVersion to THREE.GLSL3 when RawShaderMaterial uses GLSL 3 syntax",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (material?.constructorName !== "RawShaderMaterial") return;
      const glslVersion = readThreeGlslVersion(material.properties.get("glslVersion"), context);
      if (glslVersion !== "glsl1") return;
      const incompatibleShader = [material.vertexShader, material.fragmentShader].find(
        (shader): shader is StaticThreeShaderStage =>
          Boolean(shader && shaderUsesGlsl3Syntax(shader)),
      );
      if (!incompatibleShader) return;
      context.report({
        node: incompatibleShader.expression,
        message:
          "This RawShaderMaterial uses GLSL 3-only syntax but does not set glslVersion to THREE.GLSL3, so Three.js compiles it as GLSL 1",
      });
    },
  }),
});
