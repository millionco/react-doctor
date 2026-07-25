import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  collectGlslGlobalDeclarations,
  type GlslGlobalDeclaration,
} from "./utils/collect-glsl-global-declarations.js";
import { hasGlslArrayDimensionMismatch } from "./utils/has-glsl-array-dimension-mismatch.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";

const PRECISION_QUALIFIER_NAMES: ReadonlyArray<string> = ["highp", "mediump", "lowp"];

const getPrecision = (declaration: GlslGlobalDeclaration): string | null =>
  PRECISION_QUALIFIER_NAMES.find((precision) => declaration.qualifiers.has(precision)) ?? null;

const getMismatch = (
  vertexUniform: GlslGlobalDeclaration,
  fragmentUniform: GlslGlobalDeclaration,
): string | null => {
  if (vertexUniform.typeName !== fragmentUniform.typeName) {
    return `type ${vertexUniform.typeName} in the vertex shader and ${fragmentUniform.typeName} in the fragment shader`;
  }
  if (hasGlslArrayDimensionMismatch(vertexUniform.arraySize, fragmentUniform.arraySize)) {
    return "different array dimensions";
  }
  const vertexPrecision = getPrecision(vertexUniform);
  const fragmentPrecision = getPrecision(fragmentUniform);
  return vertexPrecision === null ||
    fragmentPrecision === null ||
    vertexPrecision === fragmentPrecision
    ? null
    : `precision ${vertexPrecision} in the vertex shader and ${fragmentPrecision} in the fragment shader`;
};

const getUsedUniforms = (
  declarations: readonly GlslGlobalDeclaration[],
): Map<string, GlslGlobalDeclaration> =>
  new Map(
    declarations
      .filter(
        (declaration) => declaration.qualifiers.has("uniform") && declaration.isStaticallyUsed,
      )
      .map((declaration) => [declaration.name, declaration]),
  );

export const threeShaderRequireMatchingUniforms = defineRule({
  id: "three-shader-require-matching-uniforms",
  title: "Shader stages declare incompatible uniforms",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use the same type, array dimensions, and precision for uniforms shared by both shader stages",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material?.vertexShader || !material.fragmentShader) return;
      const vertexUniforms = getUsedUniforms(
        collectGlslGlobalDeclarations(material.vertexShader.program),
      );
      const fragmentUniforms = getUsedUniforms(
        collectGlslGlobalDeclarations(material.fragmentShader.program),
      );
      for (const [uniformName, fragmentUniform] of fragmentUniforms) {
        const vertexUniform = vertexUniforms.get(uniformName);
        if (!vertexUniform) continue;
        const mismatch = getMismatch(vertexUniform, fragmentUniform);
        if (!mismatch) continue;
        context.report({
          node: material.fragmentShader.source.getOriginNodeAtOffset(
            fragmentUniform.node.location?.start.offset ?? 0,
          ),
          message: `Uniform ${uniformName} has ${mismatch}, so the shader stages cannot link consistently`,
        });
      }
    },
  }),
});
