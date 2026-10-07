import type { FunctionCallNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";

export const getGlslFunctionCallName = (node: FunctionCallNode): string | null => {
  if (node.identifier.type === "identifier") return node.identifier.identifier;
  if (node.identifier.type !== "type_specifier") return null;
  const specifier = node.identifier.specifier;
  if (specifier.type === "keyword") return specifier.token;
  return specifier.type === "identifier" || specifier.type === "type_name"
    ? specifier.identifier
    : null;
};
