import { JSX_FILE_PATTERN } from "./constants.js";
import type { ProjectInfo } from "./types/index.js";

export const NEXT_ENTRY_FILE_PATTERN =
  /^(?:\.\/)?(?:src\/)?(?:middleware|proxy)\.(?:tsx?|jsx?|mts|mjs)$/;

export const shouldIncludeExplicitLintPath = (filePath: string, project?: ProjectInfo): boolean =>
  JSX_FILE_PATTERN.test(filePath) ||
  (project?.framework === "nextjs" && NEXT_ENTRY_FILE_PATTERN.test(filePath));

export const computeExplicitLintIncludePaths = (
  includePaths: string[],
  project?: ProjectInfo,
): string[] | undefined =>
  includePaths.length > 0
    ? includePaths.filter((filePath) => shouldIncludeExplicitLintPath(filePath, project))
    : undefined;
