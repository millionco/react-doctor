import { isLintableSourceFile } from "./utils/is-lintable-source-file.js";

export const computeExplicitLintIncludePaths = (includePaths: string[]): string[] | undefined =>
  includePaths.length > 0 ? includePaths.filter(isLintableSourceFile) : undefined;
