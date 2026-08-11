import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  GPU_COMPUTATION_VARIABLE_NAME_ARGUMENT_INDEX,
  THREE_RENDERER_MANAGED_SHADER_UNIFORM_NAMES,
  THREE_SHADER_MATERIAL_INJECTED_FRAGMENT_NAMES,
  THREE_SHADER_MATERIAL_INJECTED_VERTEX_NAMES,
} from "./constants.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface GpuComputationVariableName {
  readonly computationKey: string;
  readonly name: string;
  readonly node: EsTreeNodeOfType<"Literal">;
}

const GLSL_KEYWORD_NAMES: ReadonlySet<string> = new Set([
  "attribute",
  "bool",
  "break",
  "buffer",
  "case",
  "centroid",
  "coherent",
  "const",
  "continue",
  "default",
  "discard",
  "do",
  "double",
  "else",
  "flat",
  "float",
  "for",
  "highp",
  "if",
  "in",
  "inout",
  "int",
  "invariant",
  "layout",
  "lowp",
  "mat2",
  "mat3",
  "mat4",
  "mediump",
  "noperspective",
  "out",
  "patch",
  "precision",
  "readonly",
  "restrict",
  "return",
  "sample",
  "sampler2D",
  "samplerCube",
  "shared",
  "smooth",
  "struct",
  "subroutine",
  "switch",
  "uniform",
  "uint",
  "varying",
  "vec2",
  "vec3",
  "vec4",
  "void",
  "volatile",
  "while",
  "writeonly",
]);

const isInvalidVariableName = (variableName: string): boolean =>
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName) ||
  variableName.startsWith("gl_") ||
  variableName.includes("__") ||
  GLSL_KEYWORD_NAMES.has(variableName) ||
  THREE_RENDERER_MANAGED_SHADER_UNIFORM_NAMES.has(variableName) ||
  THREE_SHADER_MATERIAL_INJECTED_FRAGMENT_NAMES.has(variableName) ||
  THREE_SHADER_MATERIAL_INJECTED_VERTEX_NAMES.has(variableName);

export const threeGpuComputationValidVariableName = defineRule({
  id: "three-gpu-computation-valid-variable-name",
  title: "GPU computation variable has an invalid shader name",
  category: "Correctness",
  severity: "error",
  recommendation: "Use a unique, non-reserved GLSL identifier for each computation variable",
  create: (context: RuleContext) => {
    const variables: GpuComputationVariableName[] = [];
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          getStaticPropertyName(node.callee) !== "addVariable" ||
          getThreeConstructorName(node.callee.object, context.scopes) !== "GPUComputationRenderer"
        ) {
          return;
        }
        const nameArgument = node.arguments[GPU_COMPUTATION_VARIABLE_NAME_ARGUMENT_INDEX];
        const computationKey = resolveExpressionKey(node.callee.object, context);
        if (
          !nameArgument ||
          !isNodeOfType(nameArgument, "Literal") ||
          typeof nameArgument.value !== "string" ||
          !computationKey
        ) {
          return;
        }
        if (isInvalidVariableName(nameArgument.value)) {
          context.report({
            node: nameArgument,
            message: `GPU computation variable name ${nameArgument.value} is not a safe user-defined GLSL identifier`,
          });
        }
        variables.push({ computationKey, name: nameArgument.value, node: nameArgument });
      },
      "Program:exit"() {
        const firstVariableByKey = new Map<string, GpuComputationVariableName>();
        for (const variable of variables) {
          const key = `${variable.computationKey}:${variable.name}`;
          if (!firstVariableByKey.has(key)) {
            firstVariableByKey.set(key, variable);
            continue;
          }
          context.report({
            node: variable.node,
            message: `GPU computation variable name ${variable.name} is added more than once to the same renderer`,
          });
        }
      },
    };
  },
});
