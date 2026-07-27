import type { Program } from "@shaderfrog/glsl-parser/ast/ast-types.js";

export const hasGlslFunctionDeclaration = (program: Program, functionName: string): boolean => {
  const overloads = program.scopes[0]?.functions[functionName];
  return Boolean(
    overloads && Object.values(overloads).some((overload) => Boolean(overload.declaration)),
  );
};
