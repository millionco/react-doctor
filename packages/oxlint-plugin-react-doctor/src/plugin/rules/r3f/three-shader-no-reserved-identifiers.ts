import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { IdentifierNode, TypeNameNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const isReservedIdentifier = (identifierName: string): boolean =>
  identifierName.startsWith("gl_") || identifierName.includes("__");

const checkIdentifier = (
  identifier: IdentifierNode | TypeNameNode,
  shader: StaticThreeShaderStage,
  context: RuleContext,
): void => {
  if (!isReservedIdentifier(identifier.identifier)) return;
  context.report({
    node: shader.source.getOriginNodeAtOffset(identifier.location?.start.offset ?? 0),
    message: `GLSL identifier ${identifier.identifier} uses a namespace reserved for the language or implementation`,
  });
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  visit(shader.program, {
    declaration: {
      enter: ({ node }) => checkIdentifier(node.identifier, shader, context),
    },
    function_header: {
      enter: ({ node }) => checkIdentifier(node.name, shader, context),
    },
    interface_declarator: {
      enter: ({ node }) => {
        checkIdentifier(node.interface_type, shader, context);
        if (node.identifier) checkIdentifier(node.identifier.identifier, shader, context);
      },
    },
    parameter_declaration: {
      enter: ({ node }) => checkIdentifier(node.identifier, shader, context),
    },
    struct: {
      enter: ({ node }) => checkIdentifier(node.typeName, shader, context),
    },
    struct_declarator: {
      enter: ({ node }) => {
        for (const declaration of node.declarations) {
          checkIdentifier(declaration.identifier, shader, context);
        }
      },
    },
  });
};

export const threeShaderNoReservedIdentifiers = defineRule({
  id: "three-shader-no-reserved-identifiers",
  title: "Shader declares a reserved GLSL identifier",
  category: "Correctness",
  severity: "error",
  recommendation: "Rename user-defined identifiers that start with gl_ or contain __",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      for (const shader of [material.vertexShader, material.fragmentShader]) {
        if (shader) checkShader(shader, context);
      }
    },
  }),
});
