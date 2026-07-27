import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode, FunctionCallNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { GLSL_MAX_LDEXP_EXPONENT } from "./constants.js";
import { getGlslFunctionCallArguments } from "./utils/get-glsl-function-call-arguments.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { getGlslNumericConstant } from "./utils/get-glsl-numeric-constant.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const INVALID_NONPOSITIVE_FUNCTIONS: ReadonlySet<string> = new Set(["inversesqrt", "log", "log2"]);

const getInvalidFunctionCallMessage = (
  node: FunctionCallNode,
  shader: StaticThreeShaderStage,
): string | null => {
  const functionName = getGlslFunctionCallName(node);
  if (
    !functionName ||
    hasGlslFunctionLikeMacro(shader.source.text, functionName) ||
    hasGlslFunctionDeclaration(shader.program, functionName)
  ) {
    return null;
  }
  const callArguments = getGlslFunctionCallArguments(node);
  const firstArgument = callArguments[0];
  if (!firstArgument) return null;
  const firstValue = getGlslNumericConstant(firstArgument);
  if (functionName === "asin" || functionName === "acos") {
    return firstValue !== null && Math.abs(firstValue) > 1
      ? `GLSL ${functionName} is undefined outside the range -1 to 1, but received ${firstValue}`
      : null;
  }
  if (functionName === "atan" && callArguments.length === 2) {
    const secondValue = getGlslNumericConstant(callArguments[1]);
    return firstValue === 0 && secondValue === 0
      ? "GLSL atan is undefined when both arguments are zero"
      : null;
  }
  if (functionName === "acosh") {
    return firstValue !== null && firstValue < 1
      ? `GLSL acosh is undefined below 1, but received ${firstValue}`
      : null;
  }
  if (functionName === "atanh") {
    return firstValue !== null && Math.abs(firstValue) >= 1
      ? `GLSL atanh is undefined outside the range -1 to 1, but received ${firstValue}`
      : null;
  }
  if (functionName === "ldexp" && callArguments.length === 2) {
    const exponent = getGlslNumericConstant(callArguments[1]);
    return exponent !== null && exponent > GLSL_MAX_LDEXP_EXPONENT
      ? `GLSL ldexp is undefined above exponent ${GLSL_MAX_LDEXP_EXPONENT}, but received ${exponent}`
      : null;
  }
  if (functionName === "pow") {
    if (firstValue !== null && firstValue < 0) {
      return `GLSL pow is undefined for the negative base ${firstValue}`;
    }
    const exponent = callArguments[1] ? getGlslNumericConstant(callArguments[1]) : null;
    return firstValue === 0 && exponent !== null && exponent <= 0
      ? `GLSL pow is undefined for a zero base and the nonpositive exponent ${exponent}`
      : null;
  }
  if (functionName === "sqrt") {
    return firstValue !== null && firstValue < 0
      ? `GLSL sqrt is undefined for the negative argument ${firstValue}`
      : null;
  }
  if (INVALID_NONPOSITIVE_FUNCTIONS.has(functionName)) {
    return firstValue !== null && firstValue <= 0
      ? `GLSL ${functionName} is undefined for the nonpositive argument ${firstValue}`
      : null;
  }
  if (functionName !== "mod" || callArguments.length !== 2) return null;
  const divisor = getGlslNumericConstant(callArguments[1]);
  return divisor === 0 ? "GLSL mod is undefined with a zero divisor" : null;
};

const reportConstantZeroDivisor = (
  operator: string,
  right: AstNode,
  locationOffset: number | undefined,
  shader: StaticThreeShaderStage,
  context: RuleContext,
): void => {
  if (getGlslNumericConstant(right) !== 0) return;
  context.report({
    node: shader.source.getOriginNodeAtOffset(locationOffset ?? 0),
    message: `GLSL ${operator.startsWith("/") ? "division" : "remainder"} by a constant zero has undefined results`,
  });
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  visit(shader.program, {
    binary: {
      enter: ({ node }) => {
        if (node.operator.literal !== "/" && node.operator.literal !== "%") return;
        reportConstantZeroDivisor(
          node.operator.literal,
          node.right,
          node.location?.start.offset,
          shader,
          context,
        );
      },
    },
    assignment: {
      enter: ({ node }) => {
        if (node.operator.literal !== "/=" && node.operator.literal !== "%=") return;
        reportConstantZeroDivisor(
          node.operator.literal,
          node.right,
          node.location?.start.offset,
          shader,
          context,
        );
      },
    },
    function_call: {
      enter: ({ node }) => {
        const message = getInvalidFunctionCallMessage(node, shader);
        if (!message) return;
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message,
        });
      },
    },
  });
};

export const threeShaderNoInvalidConstantMath = defineRule({
  id: "three-shader-no-invalid-constant-math",
  title: "Shader uses invalid constant math",
  category: "Correctness",
  severity: "error",
  recommendation: "Keep constant arguments within the defined GLSL builtin and operator domains",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
