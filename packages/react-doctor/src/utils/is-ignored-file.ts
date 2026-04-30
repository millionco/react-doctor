import type { ReactDoctorConfig } from "../types.js";
import { compileGlobPattern } from "./match-glob-pattern.js";

const toRelativePath = (filePath: string, rootDirectory: string): string => {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedRoot = rootDirectory.replace(/\\/g, "/").replace(/\/$/, "") + "/";

  if (normalizedFilePath.startsWith(normalizedRoot)) {
    return normalizedFilePath.slice(normalizedRoot.length);
  }

  return normalizedFilePath.replace(/^\.\//, "");
};

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
