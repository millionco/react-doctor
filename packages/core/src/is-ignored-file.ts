import type { ReactDoctorConfig } from "@react-doctor/types";
import { compileGlobPattern } from "./utils/match-glob-pattern.js";
import { toRelativePath } from "./utils/to-relative-path.js";

export const compileIgnoredFilePatterns = (userConfig: ReactDoctorConfig | null): RegExp[] => {
  const files = userConfig?.ignore?.files;
  if (!Array.isArray(files)) return [];
  return files
    .filter((entry): entry is string => typeof entry === "string")
    .map(compileGlobPattern);
};

export const isFileIgnoredByPatterns = (
  filePath: string,
  rootDirectory: string,
  patterns: RegExp[],
): boolean => {
  if (patterns.length === 0) {
    return false;
  }

  const relativePath = toRelativePath(filePath, rootDirectory);
  return patterns.some((pattern) => pattern.test(relativePath));
};
