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

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  if (
    hasGlslFunctionLikeMacro(shader.source.text, "clamp") ||
    hasGlslFunctionDeclaration(shader.program, "clamp")
  ) {
    return;
  }
  visit(shader.program, {
    function_call: {
      enter: ({ node }) => {
        if (getGlslFunctionCallName(node) !== "clamp") return;
        const argumentsWithoutSeparators = getGlslFunctionCallArguments(node);
        if (argumentsWithoutSeparators.length !== 3) return;
        const minimum = getGlslNumericConstant(argumentsWithoutSeparators[1]);
        const maximum = getGlslNumericConstant(argumentsWithoutSeparators[2]);
        if (minimum === null || maximum === null || minimum <= maximum) return;
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message: `GLSL clamp requires minVal not to exceed maxVal, but this call uses ${minimum} and ${maximum}, so its result is undefined`,
        });
      },
    },
  });
};

export const threeShaderNoInvalidClampBounds = defineRule({
  id: "three-shader-no-invalid-clamp-bounds",
  title: "Shader uses invalid clamp bounds",
  category: "Correctness",
  severity: "error",
  recommendation: "Keep clamp minVal less than or equal to maxVal",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
