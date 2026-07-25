import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode, FunctionCallNode, Path } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { doesGlslExpressionDependOnFragmentInput } from "./utils/does-glsl-expression-depend-on-fragment-input.js";
import { getGlslFunctionCallName } from "./utils/get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./utils/has-glsl-function-declaration.js";
import { hasGlslFunctionLikeMacro } from "./utils/has-glsl-function-like-macro.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const DERIVATIVE_FUNCTION_NAMES: ReadonlySet<string> = new Set(["dFdx", "dFdy", "fwidth"]);
const IMPLICIT_DERIVATIVE_TEXTURE_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "texture",
  "texture2D",
  "texture2DProj",
  "texture3D",
  "texture3DProj",
  "textureCube",
]);

const getControllingExpression = (path: Path<FunctionCallNode>): AstNode | null => {
  let currentPath: Path<AstNode> | undefined = path;
  while (currentPath?.parentPath) {
    const parentPath: Path<AstNode> = currentPath.parentPath;
    const parent = parentPath.node;
    if (parent.type === "function") return null;
    if (
      parent.type === "if_statement" &&
      (currentPath.key === "body" || currentPath.key === "else")
    ) {
      return parent.condition;
    }
    if (parent.type === "while_statement" && currentPath.key === "body") {
      return parent.condition;
    }
    if (parent.type === "do_statement" && currentPath.key === "body") {
      return parent.expression;
    }
    if (parent.type === "for_statement" && currentPath.key === "body") {
      return parent.condition;
    }
    if (parent.type === "ternary" && (currentPath.key === "left" || currentPath.key === "right")) {
      return parent.expression;
    }
    if (
      parent.type === "binary" &&
      currentPath.key === "right" &&
      (parent.operator.literal === "&&" || parent.operator.literal === "||")
    ) {
      return parent.left;
    }
    if (parent.type === "switch_statement" && currentPath.key === "cases") {
      return parent.expression;
    }
    currentPath = parentPath;
  }
  return null;
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  const fragmentInputNames = new Set(
    collectGlslGlobalDeclarations(shader.program)
      .filter(
        (declaration) => declaration.qualifiers.has("in") || declaration.qualifiers.has("varying"),
      )
      .map((declaration) => declaration.name),
  );
  visit(shader.program, {
    function_call: {
      enter: (path) => {
        const functionName = getGlslFunctionCallName(path.node);
        if (
          !functionName ||
          (!DERIVATIVE_FUNCTION_NAMES.has(functionName) &&
            !IMPLICIT_DERIVATIVE_TEXTURE_FUNCTION_NAMES.has(functionName)) ||
          hasGlslFunctionLikeMacro(shader.source.text, functionName) ||
          hasGlslFunctionDeclaration(shader.program, functionName)
        ) {
          return;
        }
        const controllingExpression = getControllingExpression(path);
        if (
          !controllingExpression ||
          !doesGlslExpressionDependOnFragmentInput(controllingExpression, fragmentInputNames)
        ) {
          return;
        }
        context.report({
          node: shader.source.getOriginNodeAtOffset(path.node.location?.start.offset ?? 0),
          message: `${functionName} executes only on fragment-input-dependent lanes, so implicit derivatives are undefined. Move it before the divergent branch or use explicit gradients`,
        });
      },
    },
  });
};

export const threeShaderNoDerivativesInNonuniformFlow = defineRule({
  id: "three-shader-no-derivatives-in-nonuniform-flow",
  title: "Shader derivative runs in non-uniform control flow",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Evaluate derivatives and implicit-LOD texture samples before fragment-input-dependent branches",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (material?.fragmentShader) checkShader(material.fragmentShader, context);
    },
  }),
});
