import type { ProjectInfo, ReactDoctorConfig } from "./types/index.js";
import { shouldIncludeExplicitLintPath } from "./explicit-lint-include-paths.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";
import { listSourceFiles } from "./utils/list-source-files.js";

export const resolveLintIncludePaths = (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null,
  project?: ProjectInfo,
): string[] | undefined => {
  if (!Array.isArray(userConfig?.ignore?.files) || userConfig.ignore.files.length === 0) {
    return undefined;
  }

  const ignoredPatterns = compileIgnoredFilePatterns(userConfig);

  const includedPaths = listSourceFiles(rootDirectory).filter((filePath) => {
    if (!shouldIncludeExplicitLintPath(filePath, project)) {
      return false;
    }

    return !isFileIgnoredByPatterns(filePath, rootDirectory, ignoredPatterns);
  });

  return includedPaths;
};
