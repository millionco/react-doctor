import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  collectGlslGlobalDeclarations,
  type GlslGlobalDeclaration,
} from "./utils/collect-glsl-global-declarations.js";
import { hasGlslArrayDimensionMismatch } from "./utils/has-glsl-array-dimension-mismatch.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";

const isVertexOutput = (declaration: GlslGlobalDeclaration): boolean =>
  declaration.qualifiers.has("out") || declaration.qualifiers.has("varying");

const isFragmentInput = (declaration: GlslGlobalDeclaration): boolean =>
  declaration.qualifiers.has("in") || declaration.qualifiers.has("varying");

const getInterfaceMismatch = (
  vertexOutput: GlslGlobalDeclaration,
  fragmentInput: GlslGlobalDeclaration,
): string | null => {
  if (vertexOutput.typeName !== fragmentInput.typeName) {
    return `type ${vertexOutput.typeName} in the vertex shader but ${fragmentInput.typeName} in the fragment shader`;
  }
  if (hasGlslArrayDimensionMismatch(vertexOutput.arraySize, fragmentInput.arraySize)) {
    return "different array dimensions";
  }
  return vertexOutput.interpolation === fragmentInput.interpolation
    ? null
    : `interpolation ${vertexOutput.interpolation} in the vertex shader but ${fragmentInput.interpolation} in the fragment shader`;
};

export const threeShaderRequireMatchingVaryings = defineRule({
  id: "three-shader-require-matching-varyings",
  title: "Shader stage interface does not match",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Declare every statically used fragment input as a compatible vertex output with the same name",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material?.vertexShader || !material.fragmentShader) return;
      const vertexOutputs = new Map(
        collectGlslGlobalDeclarations(material.vertexShader.program)
          .filter(isVertexOutput)
          .map((declaration) => [declaration.name, declaration]),
      );
      const fragmentInputs = collectGlslGlobalDeclarations(material.fragmentShader.program).filter(
        (declaration) =>
          isFragmentInput(declaration) &&
          declaration.isStaticallyUsed &&
          !declaration.name.startsWith("gl_") &&
          !declaration.hasLayoutQualifier,
      );
      for (const fragmentInput of fragmentInputs) {
        const vertexOutput = vertexOutputs.get(fragmentInput.name);
        const mismatch = vertexOutput
          ? getInterfaceMismatch(vertexOutput, fragmentInput)
          : "no matching vertex output";
        if (!mismatch) continue;
        context.report({
          node: material.fragmentShader.source.getOriginNodeAtOffset(
            fragmentInput.node.location?.start.offset ?? 0,
          ),
          message: `Fragment input ${fragmentInput.name} has ${mismatch}, so the shader program cannot link with a defined value`,
        });
      }
    },
  }),
});
