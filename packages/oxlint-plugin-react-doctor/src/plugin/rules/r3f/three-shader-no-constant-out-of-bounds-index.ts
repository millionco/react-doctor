import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  collectGlslGlobalDeclarations,
  type GlslGlobalDeclaration,
} from "./utils/collect-glsl-global-declarations.js";
import { getGlslNumericConstant } from "./utils/get-glsl-numeric-constant.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const getDeclarationElementCount = (declaration: GlslGlobalDeclaration): number | null => {
  if (typeof declaration.arraySize === "number") return declaration.arraySize;
  const vectorMatch = /^[biud]?vec([234])$/.exec(declaration.typeName);
  if (vectorMatch) return Number(vectorMatch[1]);
  const matrixMatch = /^mat([234])(?:x[234])?$/.exec(declaration.typeName);
  return matrixMatch ? Number(matrixMatch[1]) : null;
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  const declarationsByName = new Map(
    collectGlslGlobalDeclarations(shader.program).map((declaration) => [
      declaration.name,
      declaration,
    ]),
  );
  const globalBindings = shader.program.scopes[0]?.bindings;
  visit(shader.program, {
    postfix: {
      enter: ({ node }) => {
        if (node.expression.type !== "identifier") return;
        const quantifier =
          node.postfix.type === "quantifier"
            ? node.postfix
            : node.postfix.type === "postfix" && node.postfix.expression.type === "quantifier"
              ? node.postfix.expression
              : null;
        if (!quantifier) return;
        const declaration = declarationsByName.get(node.expression.identifier);
        const elementCount = declaration ? getDeclarationElementCount(declaration) : null;
        const index = getGlslNumericConstant(quantifier.expression);
        const binding = globalBindings?.[node.expression.identifier];
        if (
          elementCount === null ||
          index === null ||
          !Number.isInteger(index) ||
          !binding?.references.includes(node.expression) ||
          (index >= 0 && index < elementCount)
        ) {
          return;
        }
        context.report({
          node: shader.source.getOriginNodeAtOffset(node.location?.start.offset ?? 0),
          message: `The constant index ${index} is outside ${declaration?.name}'s valid range 0–${elementCount - 1}, which is a GLSL compile error or undefined access`,
        });
      },
    },
  });
};

export const threeShaderNoConstantOutOfBoundsIndex = defineRule({
  id: "three-shader-no-constant-out-of-bounds-index",
  title: "Shader uses a constant out-of-bounds index",
  category: "Correctness",
  severity: "error",
  recommendation: "Keep constant array, vector, and matrix indices within their declared bounds",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
