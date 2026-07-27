import type { TypeSpecifierNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";

export const getGlslTypeSpecifierName = (specifier: TypeSpecifierNode): string | null => {
  const typeName = specifier.specifier;
  if (typeName.type === "keyword") return typeName.token;
  if (typeName.type === "identifier" || typeName.type === "type_name") {
    return typeName.identifier;
  }
  return null;
};
