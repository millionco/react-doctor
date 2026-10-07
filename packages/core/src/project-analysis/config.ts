import { resolve } from "node:path";
import { DEFAULT_ENTRY_GLOBS, DEFAULT_EXTENSIONS } from "./constants.js";
import type { ProjectAnalysisConfig } from "./types.js";
import { toCanonicalPath } from "../utils/to-canonical-path.js";

export const defineProjectAnalysisConfig = (
  options: Partial<ProjectAnalysisConfig> & Pick<ProjectAnalysisConfig, "rootDir">,
): ProjectAnalysisConfig => {
  const rootDir = toCanonicalPath(resolve(options.rootDir));
  return {
    rootDir,
    entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
    ignorePatterns: options.ignorePatterns ?? [],
    includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
    tsConfigPath:
      options.tsConfigPath === undefined
        ? undefined
        : toCanonicalPath(resolve(rootDir, options.tsConfigPath)),
    paths: options.paths,
    reportTypes: options.reportTypes ?? true,
    includeEntryExports: options.includeEntryExports ?? false,
    hasExplicitEntryPatterns:
      options.hasExplicitEntryPatterns ?? options.entryPatterns !== undefined,
  };
};
