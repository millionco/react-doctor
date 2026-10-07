import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";

const FRAGMENT_INPUT_BUILTIN_NAMES: ReadonlySet<string> = new Set([
  "gl_FragCoord",
  "gl_FrontFacing",
  "gl_HelperInvocation",
  "gl_Layer",
  "gl_PointCoord",
  "gl_PrimitiveID",
  "gl_SampleID",
  "gl_SampleMaskIn",
  "gl_SamplePosition",
  "gl_ViewportIndex",
]);

export const doesGlslExpressionDependOnFragmentInput = (
  expression: AstNode,
  fragmentInputReferences: ReadonlySet<AstNode>,
): boolean => {
  let dependsOnFragmentInput = false;
  visit(expression, {
    identifier: {
      enter: (path) => {
        if (
          dependsOnFragmentInput ||
          path.parent?.type === "field_selection" ||
          (path.parent?.type === "function_call" && path.key === "identifier") ||
          path.parent?.type === "type_specifier"
        ) {
          return;
        }
        dependsOnFragmentInput =
          fragmentInputReferences.has(path.node) ||
          FRAGMENT_INPUT_BUILTIN_NAMES.has(path.node.identifier);
      },
    },
  });
  return dependsOnFragmentInput;
};
