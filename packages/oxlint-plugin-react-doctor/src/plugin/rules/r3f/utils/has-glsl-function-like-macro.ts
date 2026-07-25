import { maskGlslComments } from "./mask-glsl-comments.js";

export const hasGlslFunctionLikeMacro = (source: string, functionName: string): boolean =>
  new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${functionName}(?:[ \\t]|\\()`, "m").test(
    maskGlslComments(source),
  );
