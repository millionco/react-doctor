import { resolve } from "node:path";
import { DEFAULT_ENTRY_GLOBS, DEFAULT_EXTENSIONS } from "./constants.js";
import type { ProjectAnalysisConfig } from "./types.js";

export const defineProjectAnalysisConfig = (
  options: Partial<ProjectAnalysisConfig> & Pick<ProjectAnalysisConfig, "rootDir">,
): ProjectAnalysisConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath,
  paths: options.paths,
  reportTypes: options.reportTypes ?? true,
  includeEntryExports: options.includeEntryExports ?? false,
});
