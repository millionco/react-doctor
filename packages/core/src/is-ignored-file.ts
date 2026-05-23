import type { ReactDoctorConfig } from "./types/index.js";
import { compileGlobPatternsLenient } from "./utils/match-glob-pattern.js";
import { toRelativePath } from "./utils/to-relative-path.js";
import { warnConfigIssue } from "./utils/warn-config-issue.js";

export const compileIgnoredFilePatterns = (userConfig: ReactDoctorConfig | null): RegExp[] => {
  const files = userConfig?.ignore?.files;
  if (!Array.isArray(files)) return [];
  const stringPatterns = files.filter((entry): entry is string => typeof entry === "string");
  return compileGlobPatternsLenient(stringPatterns, (error) =>
    warnConfigIssue(`ignore.files: ${error.message}`),
  );
};

export const isFileIgnoredByPatterns = (
  filePath: string,
  rootDirectory: string,
  patterns: RegExp[],
): boolean => {
  if (patterns.length === 0) return false;
  const relativePath = toRelativePath(filePath, rootDirectory);
  return patterns.some((pattern) => pattern.test(relativePath));
};
