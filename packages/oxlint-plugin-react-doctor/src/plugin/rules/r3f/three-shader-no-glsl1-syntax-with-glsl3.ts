import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import { maskGlslComments } from "./utils/mask-glsl-comments.js";
import { readThreeGlslVersion } from "./utils/read-three-glsl-version.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const LEGACY_TEXTURE_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "texture2D",
  "texture2DGradEXT",
  "texture2DLodEXT",
  "texture2DProj",
  "texture2DProjGradEXT",
  "texture2DProjLodEXT",
  "textureCube",
  "textureCubeGradEXT",
  "textureCubeLodEXT",
]);
const LEGACY_FRAGMENT_OUTPUT_NAMES: ReadonlySet<string> = new Set(["gl_FragColor", "gl_FragData"]);

const getLegacySyntax = (
  shader: StaticThreeShaderStage,
  isRawShaderMaterial: boolean,
): string | null => {
  if (isRawShaderMaterial) {
    const legacyDeclaration = collectGlslGlobalDeclarations(shader.program).find(
      (declaration) =>
        declaration.qualifiers.has("attribute") || declaration.qualifiers.has("varying"),
    );
    if (legacyDeclaration) {
      return legacyDeclaration.qualifiers.has("attribute") ? "attribute" : "varying";
    }
  }
  const sourceWithoutComments = maskGlslComments(shader.source.text);
  let legacySyntax: string | null = null;
  visit(shader.program, {
    function_call: {
      enter: ({ node }) => {
        if (legacySyntax || !isRawShaderMaterial) return;
        const functionName = getGlslFunctionCallName(node);
        if (
          !functionName ||
          !LEGACY_TEXTURE_FUNCTION_NAMES.has(functionName) ||
          hasGlslFunctionLikeMacro(shader.source.text, functionName) ||
          hasGlslFunctionDeclaration(shader.program, functionName)
        ) {
          return;
        }
        legacySyntax = functionName;
      },
    },
    identifier: {
      enter: ({ node }) => {
        if (
          legacySyntax ||
          shader.stage !== "fragment" ||
          !LEGACY_FRAGMENT_OUTPUT_NAMES.has(node.identifier) ||
          new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${node.identifier}\\b`, "m").test(
            sourceWithoutComments,
          )
        ) {
          return;
        }
        legacySyntax = node.identifier;
      },
    },
  });
  return legacySyntax;
};

export const threeShaderNoGlsl1SyntaxWithGlsl3 = defineRule({
  id: "three-shader-no-glsl1-syntax-with-glsl3",
  title: "GLSL 3 shader uses an unavailable GLSL 1 symbol",
  category: "Correctness",
  severity: "error",
  recommendation: "Use GLSL 3 in/out declarations, texture(), and an explicit fragment output",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (
        !material ||
        readThreeGlslVersion(material.properties.get("glslVersion"), context) !== "glsl3"
      ) {
        return;
      }
      for (const shader of [material.vertexShader, material.fragmentShader]) {
        if (!shader) continue;
        const legacySyntax = getLegacySyntax(
          shader,
          material.constructorName === "RawShaderMaterial",
        );
        if (!legacySyntax) continue;
        context.report({
          node: shader.expression,
          message: `This GLSL 3 ${shader.stage} shader uses ${legacySyntax}, which Three.js does not provide in this material configuration`,
        });
      }
    },
  }),
});
