import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode, FunctionCallNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { GLSL_INTEGER_BIT_WIDTH } from "./constants.js";
import { getGlslFunctionCallArguments } from "./utils/get-glsl-function-call-arguments.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { getGlslNumericConstant } from "./utils/get-glsl-numeric-constant.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const getInvalidBitfieldMessage = (
  node: FunctionCallNode,
  shader: StaticThreeShaderStage,
): string | null => {
  const functionName = getGlslFunctionCallName(node);
  if (
    (functionName !== "bitfieldExtract" && functionName !== "bitfieldInsert") ||
    hasGlslFunctionLikeMacro(shader.source.text, functionName) ||
    hasGlslFunctionDeclaration(shader.program, functionName)
  ) {
    return null;
  }
  const callArguments = getGlslFunctionCallArguments(node);
  const offsetArgumentIndex = functionName === "bitfieldExtract" ? 1 : 2;
  const bitsArgumentIndex = offsetArgumentIndex + 1;
  const offset = callArguments[offsetArgumentIndex]
    ? getGlslNumericConstant(callArguments[offsetArgumentIndex])
    : null;
  const bits = callArguments[bitsArgumentIndex]
    ? getGlslNumericConstant(callArguments[bitsArgumentIndex])
    : null;
  if (
    offset === null ||
    bits === null ||
    (offset >= 0 && bits >= 0 && offset + bits <= GLSL_INTEGER_BIT_WIDTH)
  ) {
    return null;
  }
  return `GLSL ${functionName} uses offset ${offset} and width ${bits}, outside a ${GLSL_INTEGER_BIT_WIDTH}-bit integer`;
};

const reportInvalidShift = (
  right: AstNode,
  locationOffset: number | undefined,
  shader: StaticThreeShaderStage,
  context: RuleContext,
): void => {
  const shiftCount = getGlslNumericConstant(right);
  if (shiftCount === null || (shiftCount >= 0 && shiftCount < GLSL_INTEGER_BIT_WIDTH)) return;
  context.report({
    node: shader.source.getOriginNodeAtOffset(locationOffset ?? 0),
    message: `GLSL shift count ${shiftCount} is outside the valid range 0–${GLSL_INTEGER_BIT_WIDTH - 1}`,
  });
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  visit(shader.program, {
    binary: {
      enter: ({ node }) => {
        if (node.operator.literal !== "<<" && node.operator.literal !== ">>") return;
        reportInvalidShift(node.right, node.location?.start.offset, shader, context);
      },
    },
    assignment: {
      enter: ({ node }) => {
        const operatorLiteral = String(node.operator.literal);
        if (operatorLiteral !== "<<=" && operatorLiteral !== ">>=") return;
        reportInvalidShift(node.right, node.location?.start.offset, shader, context);
      },
    },
    function_call: {
      enter: ({ node }) => {
        const message = getInvalidBitfieldMessage(node, shader);
        if (!message) return;
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message,
        });
      },
    },
  });
};

export const threeShaderNoInvalidConstantBitOperations = defineRule({
  id: "three-shader-no-invalid-constant-bit-operations",
  title: "Shader uses invalid constant bit operations",
  category: "Correctness",
  severity: "error",
  recommendation: "Keep shift counts and bitfield ranges within the integer bit width",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
