import { JSX_FILE_PATTERN } from "../constants.js";

export const computeJsxIncludePaths = (includePaths: string[]): string[] | undefined =>
  includePaths.length > 0
    ? includePaths.filter((filePath) => JSX_FILE_PATTERN.test(filePath))
    : undefined;
