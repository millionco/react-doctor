import { parse } from "@shaderfrog/glsl-parser/index.js";
import type { Program } from "@shaderfrog/glsl-parser/ast/ast-types.js";

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
  if (GLSL_CONDITIONAL_DIRECTIVE_PATTERN.test(source)) return null;
  try {
    return parse(maskThreeIncludeDirectives(source), {
      includeLocation: true,
      quiet: true,
      stage,
    });
  } catch {
    return null;
  }
};
