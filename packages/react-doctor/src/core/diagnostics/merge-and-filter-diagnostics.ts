import reactDoctorPlugin from "../../plugin/react-doctor-plugin.js";
import type { ReactDoctorConfig } from "../../types/config.js";
import type { Diagnostic } from "../../types/diagnostic.js";
import { filterIgnoredDiagnostics, filterInlineSuppressions } from "./filter-diagnostics.js";
import { isLikelyBuildEntry } from "../config/is-likely-build-entry.js";
import { isTestFilePath } from "../config/is-test-file.js";

interface MergeAndFilterOptions {
  respectInlineDisables?: boolean;
}

const testFileResultCache = new Map<string, boolean>();
const buildEntryResultCache = new Map<string, boolean>();

export const clearAutoSuppressionCaches = (): void => {
  testFileResultCache.clear();
  buildEntryResultCache.clear();
};

const shouldAutoSuppress = (diagnostic: Diagnostic, directory: string): boolean => {
  const filePath = diagnostic.filePath;

  if (diagnostic.plugin === "knip" && diagnostic.rule === "files") {
    const cacheKey = `${directory}:${filePath}`;
    let isBuildEntry = buildEntryResultCache.get(cacheKey);
    if (isBuildEntry === undefined) {
      isBuildEntry = isLikelyBuildEntry(filePath, directory);
      buildEntryResultCache.set(cacheKey, isBuildEntry);
    }
    if (isBuildEntry) return true;
  }

  const rule =
    diagnostic.plugin === "react-doctor" ? reactDoctorPlugin.rules[diagnostic.rule] : null;
  if (rule?.tags?.includes("test-noise")) {
    let isTest = testFileResultCache.get(filePath);
    if (isTest === undefined) {
      isTest = isTestFilePath(filePath);
      testFileResultCache.set(filePath, isTest);
    }
    if (isTest) return true;
  }

  return false;
};

export const mergeAndFilterDiagnostics = (
  mergedDiagnostics: Diagnostic[],
  directory: string,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null,
  options: MergeAndFilterOptions = {},
): Diagnostic[] => {
  const autoFiltered = mergedDiagnostics.filter(
    (diagnostic) => !shouldAutoSuppress(diagnostic, directory),
  );
  const filtered = userConfig
    ? filterIgnoredDiagnostics(autoFiltered, userConfig, directory, readFileLinesSync)
    : autoFiltered;
  if (options.respectInlineDisables === false) return filtered;
  return filterInlineSuppressions(filtered, directory, readFileLinesSync);
};
