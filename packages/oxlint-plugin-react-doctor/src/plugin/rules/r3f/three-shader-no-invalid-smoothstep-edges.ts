import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getGlslFunctionCallArguments } from "./utils/get-glsl-function-call-arguments.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { getGlslNumericConstant } from "./utils/get-glsl-numeric-constant.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const checkShaderSource = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  if (
    hasGlslFunctionLikeMacro(shader.source.text, "smoothstep") ||
    hasGlslFunctionDeclaration(shader.program, "smoothstep")
  ) {
    return;
  }
  visit(shader.program, {
    function_call: {
      enter: ({ node }) => {
        if (getGlslFunctionCallName(node) !== "smoothstep") return;
        const argumentsWithoutSeparators = getGlslFunctionCallArguments(node);
        if (argumentsWithoutSeparators.length !== 3) return;
        const firstEdge = getGlslNumericConstant(argumentsWithoutSeparators[0]);
        const secondEdge = getGlslNumericConstant(argumentsWithoutSeparators[1]);
        if (firstEdge === null || secondEdge === null || firstEdge < secondEdge) return;
        const shaderOffset = node.location?.start.offset ?? 0;
        context.report({
          node: shader.source.getOriginNodeAtOffset(shaderOffset),
          message: `GLSL smoothstep requires edge0 to be less than edge1, but this call uses ${firstEdge} and ${secondEdge}, so its result is undefined`,
        });
      },
    },
  });
};

export const threeShaderNoInvalidSmoothstepEdges = defineRule({
  id: "three-shader-no-invalid-smoothstep-edges",
  title: "Shader uses invalid smoothstep edges",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Keep smoothstep edge0 below edge1 and invert the result when a descending transition is needed",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShaderSource(material.fragmentShader, context);
      if (material.vertexShader) checkShaderSource(material.vertexShader, context);
    },
  }),
});
