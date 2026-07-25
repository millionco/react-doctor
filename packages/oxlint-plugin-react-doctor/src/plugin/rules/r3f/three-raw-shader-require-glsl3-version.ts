import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const GLSL3_ONLY_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "bitCount",
  "bitfieldExtract",
  "bitfieldInsert",
  "bitfieldReverse",
  "determinant",
  "findLSB",
  "findMSB",
  "floatBitsToInt",
  "floatBitsToUint",
  "intBitsToFloat",
  "inverse",
  "isinf",
  "isnan",
  "round",
  "roundEven",
  "texelFetch",
  "texture",
  "textureLod",
  "textureOffset",
  "textureProj",
  "textureSize",
  "transpose",
  "trunc",
  "uintBitsToFloat",
]);
const GLSL3_ONLY_TYPE_NAME_PATTERN = /^(?:uint|uvec[234]|sampler3D|sampler2DArray|[iu]sampler)/;

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
    function_call: {
      enter: ({ node }) => {
        const functionName = getGlslFunctionCallName(node);
        if (
          functionName &&
          GLSL3_ONLY_FUNCTION_NAMES.has(functionName) &&
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

const getGlsl3Configuration = (
  expression: EsTreeNode | undefined,
  context: RuleContext,
): boolean | null => {
  if (!expression) return false;
  if (isNodeOfType(expression, "Literal")) {
    return expression.value === "300 es";
  }
  const provenance = getApiReferenceProvenance(expression, context.scopes);
  if (!provenance || !isThreeModuleSource(provenance.moduleSource)) return null;
  return provenance.apiName === "GLSL3";
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
      const glsl3Configuration = getGlsl3Configuration(
        material.properties.get("glslVersion"),
        context,
      );
      if (glsl3Configuration !== false) return;
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
