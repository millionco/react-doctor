import { parse } from "@shaderfrog/glsl-parser/index.js";
import type { Program } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { maskGlslComments } from "./mask-glsl-comments.js";

const GLSL_CONDITIONAL_DIRECTIVE_PATTERN = /^[ \t]*#[ \t]*(?:if|ifdef|ifndef|elif|else|endif)\b/m;
const THREE_INCLUDE_DIRECTIVE_PATTERN = /^[ \t]*#[ \t]*include[ \t]+<[^>\r\n]+>[^\r\n]*/gm;

const maskThreeIncludeDirectives = (source: string): string =>
  source.replace(THREE_INCLUDE_DIRECTIVE_PATTERN, (directive) =>
    directive.replace(/[^\r\n]/g, " "),
  );

export const parseGlslShaderSource = (
  source: string,
  stage: "fragment" | "vertex",
): Program | null => {
  const sourceWithoutComments = maskGlslComments(source);
  if (GLSL_CONDITIONAL_DIRECTIVE_PATTERN.test(sourceWithoutComments)) return null;
  try {
    return parse(maskThreeIncludeDirectives(sourceWithoutComments), {
      includeLocation: true,
      quiet: true,
      stage,
    });
  } catch {
    return null;
  }
};
