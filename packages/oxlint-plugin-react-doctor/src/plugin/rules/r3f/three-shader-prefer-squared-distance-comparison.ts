import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode, FunctionCallNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { getGlslNumericConstant } from "./utils/get-glsl-numeric-constant.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const DISTANCE_FUNCTION_NAMES: ReadonlySet<string> = new Set(["distance", "length"]);
const ORDERING_OPERATORS: ReadonlySet<string> = new Set(["<", "<=", ">", ">="]);

interface DistanceComparison {
  readonly functionCall: FunctionCallNode;
  readonly threshold: number;
}

const getDistanceFunctionCall = (node: AstNode): FunctionCallNode | null => {
  if (node.type === "group") return getDistanceFunctionCall(node.expression);
  return node.type === "function_call" &&
    DISTANCE_FUNCTION_NAMES.has(getGlslFunctionCallName(node) ?? "")
    ? node
    : null;
};

const getDistanceComparison = (left: AstNode, right: AstNode): DistanceComparison | null => {
  const leftCall = getDistanceFunctionCall(left);
  const rightThreshold = getGlslNumericConstant(right);
  if (leftCall && rightThreshold !== null && rightThreshold >= 0) {
    return { functionCall: leftCall, threshold: rightThreshold };
  }
  const rightCall = getDistanceFunctionCall(right);
  const leftThreshold = getGlslNumericConstant(left);
  return rightCall && leftThreshold !== null && leftThreshold >= 0
    ? { functionCall: rightCall, threshold: leftThreshold }
    : null;
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  visit(shader.program, {
    binary: {
      enter: ({ node }) => {
        if (!ORDERING_OPERATORS.has(node.operator.literal)) return;
        const comparison = getDistanceComparison(node.left, node.right);
        if (!comparison) return;
        const functionName = getGlslFunctionCallName(comparison.functionCall);
        if (
          !functionName ||
          hasGlslFunctionLikeMacro(shader.source.text, functionName) ||
          hasGlslFunctionDeclaration(shader.program, functionName)
        ) {
          return;
        }
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message: `Compare squared ${functionName === "length" ? "length using dot(v, v)" : "distance using dot(a - b, a - b)"} against ${comparison.threshold * comparison.threshold} to avoid computing a square root`,
        });
      },
    },
  });
};

export const threeShaderPreferSquaredDistanceComparison = defineRule({
  id: "three-shader-prefer-squared-distance-comparison",
  title: "Shader compares a computed distance",
  category: "Performance",
  severity: "warn",
  recommendation: "Compare squared vector distance against a squared nonnegative threshold",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
