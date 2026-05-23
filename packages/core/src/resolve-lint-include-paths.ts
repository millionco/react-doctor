import { JSX_FILE_PATTERN } from "./constants.js";
import type { ReactDoctorConfig } from "./types/index.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";
import { listSourceFiles } from "./utils/list-source-files.js";

export const resolveLintIncludePaths = (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null,
): string[] | undefined => {
  if (!Array.isArray(userConfig?.ignore?.files) || userConfig.ignore.files.length === 0) {
    return undefined;
  }

  const ignoredPatterns = compileIgnoredFilePatterns(userConfig);

  const includedPaths = listSourceFiles(rootDirectory).filter((filePath) => {
    if (!JSX_FILE_PATTERN.test(filePath)) {
      return false;
    }

    return !isFileIgnoredByPatterns(filePath, rootDirectory, ignoredPatterns);
  });

  return includedPaths;
};
