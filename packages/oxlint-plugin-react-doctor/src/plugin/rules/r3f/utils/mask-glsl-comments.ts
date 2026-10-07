const GLSL_COMMENT_PATTERN = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g;
const NON_LINE_BREAK_PATTERN = /[^\r\n]/g;

export const maskGlslComments = (source: string): string =>
  source.replace(GLSL_COMMENT_PATTERN, (comment) => comment.replace(NON_LINE_BREAK_PATTERN, " "));
