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
  "textureOffset",
  "textureProj",
  "textureProjOffset",
]);

const getControllingExpressions = (path: Path<FunctionCallNode>): AstNode[] => {
  const controllingExpressions: AstNode[] = [];
  let currentPath: Path<AstNode> | undefined = path;
  while (currentPath?.parentPath) {
    const parentPath: Path<AstNode> = currentPath.parentPath;
    const parent = parentPath.node;
    if (parent.type === "function") break;
    const alternateNodes = parent.type === "if_statement" ? Reflect.get(parent, "else") : null;
    const isInsideAlternate =
      currentPath.key === "else" ||
      (Array.isArray(alternateNodes) && alternateNodes.includes(currentPath.node));
    if (parent.type === "if_statement" && (currentPath.key === "body" || isInsideAlternate)) {
      controllingExpressions.push(parent.condition);
    }
    if (parent.type === "while_statement" && currentPath.key === "body") {
      controllingExpressions.push(parent.condition);
    }
    if (parent.type === "do_statement" && currentPath.key === "body") {
      controllingExpressions.push(parent.expression);
    }
    if (parent.type === "for_statement" && currentPath.key === "body" && parent.condition) {
      controllingExpressions.push(
        ...[parent.init, parent.condition, parent.operation].filter(Boolean),
      );
    }
    if (parent.type === "ternary" && (currentPath.key === "left" || currentPath.key === "right")) {
      controllingExpressions.push(parent.expression);
    }
    if (
      parent.type === "binary" &&
      currentPath.key === "right" &&
      (parent.operator.literal === "&&" || parent.operator.literal === "||")
    ) {
      controllingExpressions.push(parent.left);
    }
    if (parent.type === "switch_statement" && currentPath.key === "cases") {
      controllingExpressions.push(parent.expression);
    }
    currentPath = parentPath;
  }
  return controllingExpressions;
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  const globalBindings = shader.program.scopes[0]?.bindings;
  const fragmentInputReferences = new Set<AstNode>();
  for (const declaration of collectGlslGlobalDeclarations(shader.program)) {
    if (!declaration.qualifiers.has("in") && !declaration.qualifiers.has("varying")) continue;
    const binding = globalBindings?.[declaration.name];
    if (!binding) continue;
    for (const reference of binding.references) {
      if (reference !== binding.declaration) fragmentInputReferences.add(reference);
    }
  }
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
        const hasFragmentDependentControl = getControllingExpressions(path).some(
          (controllingExpression) =>
            doesGlslExpressionDependOnFragmentInput(controllingExpression, fragmentInputReferences),
        );
        if (!hasFragmentDependentControl) {
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
