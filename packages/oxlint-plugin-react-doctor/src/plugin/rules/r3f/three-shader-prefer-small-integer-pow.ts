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

const SMALL_INTEGER_POW_EXPONENTS: ReadonlySet<number> = new Set([2, 3, 4]);

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  if (
    hasGlslFunctionLikeMacro(shader.source.text, "pow") ||
    hasGlslFunctionDeclaration(shader.program, "pow")
  ) {
    return;
  }
  visit(shader.program, {
    function_call: {
      enter: ({ node }) => {
        if (getGlslFunctionCallName(node) !== "pow") return;
        const callArguments = getGlslFunctionCallArguments(node);
        if (callArguments.length !== 2) return;
        const exponent = getGlslNumericConstant(callArguments[1]);
        if (exponent === null || !SMALL_INTEGER_POW_EXPONENTS.has(exponent)) return;
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message: `This pow call has the small integer exponent ${exponent}. Explicit multiplication avoids a general exponentiation operation and makes the intended cost clear`,
        });
      },
    },
  });
};

export const threeShaderPreferSmallIntegerPow = defineRule({
  id: "three-shader-prefer-small-integer-pow",
  title: "Shader uses pow for a small integer exponent",
  category: "Performance",
  severity: "warn",
  recommendation: "Use explicit multiplication for powers of two, three, or four",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
