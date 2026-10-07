import type { AstNode, FunctionCallNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";

export const getGlslFunctionCallArguments = (node: FunctionCallNode): AstNode[] =>
  node.args.filter((argument) => argument.type !== "literal" || argument.literal !== ",");
