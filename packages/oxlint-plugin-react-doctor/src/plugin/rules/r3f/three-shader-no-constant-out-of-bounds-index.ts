import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode, QuantifierNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";
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

const getTypeIndexElementCounts = (typeName: string): number[] => {
  const vectorMatch = /^[biud]?vec([234])$/.exec(typeName);
  if (vectorMatch) return [Number(vectorMatch[1])];
  const floatingPointMatrixMatch = /^mat([234])(?:x([234]))?$/.exec(typeName);
  return floatingPointMatrixMatch
    ? [
        Number(floatingPointMatrixMatch[1]),
        Number(floatingPointMatrixMatch[2] ?? floatingPointMatrixMatch[1]),
      ]
    : [];
};

const getDeclarationIndexElementCounts = (
  declaration: GlslGlobalDeclaration,
): ReadonlyArray<number | null> => {
  const typeElementCounts = getTypeIndexElementCounts(declaration.typeName);
  if (declaration.arraySize === null) return typeElementCounts;
  return [
    typeof declaration.arraySize === "number" ? declaration.arraySize : null,
    ...typeElementCounts,
  ];
};

const getIndexQuantifiers = (postfix: AstNode): QuantifierNode[] | null => {
  const quantifiers: QuantifierNode[] = [];
  let currentPostfix = postfix;
  while (currentPostfix.type === "postfix") {
    if (currentPostfix.expression.type !== "quantifier") {
      return quantifiers.length > 0 ? quantifiers : null;
    }
    quantifiers.push(currentPostfix.expression);
    currentPostfix = currentPostfix.postfix;
  }
  if (currentPostfix.type === "quantifier") quantifiers.push(currentPostfix);
  return quantifiers.length > 0 ? quantifiers : null;
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
        const quantifiers = getIndexQuantifiers(node.postfix);
        if (!quantifiers) return;
        const declaration = declarationsByName.get(node.expression.identifier);
        const binding = globalBindings?.[node.expression.identifier];
        if (!declaration || !binding?.references.includes(node.expression)) return;
        const elementCounts = getDeclarationIndexElementCounts(declaration);
        for (const [quantifierIndex, quantifier] of quantifiers.entries()) {
          const elementCount = elementCounts[quantifierIndex];
          const index = getGlslNumericConstant(quantifier.expression);
          if (
            elementCount === null ||
            elementCount === undefined ||
            index === null ||
            !Number.isInteger(index) ||
            (index >= 0 && index < elementCount)
          ) {
            continue;
          }
          context.report({
            node: shader.source.getOriginNodeAtOffset(quantifier.location?.start.offset ?? 0),
            message: `The constant index ${index} is outside ${declaration.name}'s valid range 0–${elementCount - 1}, which is a GLSL compile error or undefined access`,
          });
        }
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
