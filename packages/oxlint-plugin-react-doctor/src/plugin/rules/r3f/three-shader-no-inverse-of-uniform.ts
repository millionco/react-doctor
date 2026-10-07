import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { getGlslFunctionCallArguments } from "./utils/get-glsl-function-call-arguments.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  if (
    hasGlslFunctionLikeMacro(shader.source.text, "inverse") ||
    hasGlslFunctionDeclaration(shader.program, "inverse")
  ) {
    return;
  }
  const globalBindings = shader.program.scopes[0]?.bindings;
  const uniformReferences = new Set(
    collectGlslGlobalDeclarations(shader.program)
      .filter((declaration) => declaration.qualifiers.has("uniform"))
      .flatMap((declaration) => globalBindings?.[declaration.name]?.references ?? []),
  );
  visit(shader.program, {
    function_call: {
      enter: ({ node }) => {
        if (getGlslFunctionCallName(node) !== "inverse") return;
        const callArguments = getGlslFunctionCallArguments(node);
        const matrix = callArguments[0];
        if (
          callArguments.length !== 1 ||
          matrix?.type !== "identifier" ||
          !uniformReferences.has(matrix)
        ) {
          return;
        }
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message: `The matrix ${matrix.identifier} is uniform across this draw, but inverse recomputes it for every shader invocation. Compute and bind the inverse matrix on the CPU`,
        });
      },
    },
  });
};

export const threeShaderNoInverseOfUniform = defineRule({
  id: "three-shader-no-inverse-of-uniform",
  title: "Shader inverts a uniform matrix per invocation",
  category: "Performance",
  severity: "warn",
  recommendation: "Compute uniform matrix inverses once on the CPU and upload the result",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
