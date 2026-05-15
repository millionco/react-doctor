import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
import { filterIgnoredDiagnostics, filterInlineSuppressions } from "./filter-diagnostics.js";
import { isTestFilePath } from "./is-test-file.js";

interface MergeAndFilterOptions {
  respectInlineDisables?: boolean;
}

const testFileResultCache = new Map<string, boolean>();

export const clearAutoSuppressionCaches = (): void => {
  testFileResultCache.clear();
};

const shouldAutoSuppress = (diagnostic: Diagnostic): boolean => {
  const filePath = diagnostic.filePath;

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
  const autoFiltered = mergedDiagnostics.filter((diagnostic) => !shouldAutoSuppress(diagnostic));
  const filtered = userConfig
    ? filterIgnoredDiagnostics(autoFiltered, userConfig, directory, readFileLinesSync)
    : autoFiltered;
  if (options.respectInlineDisables === false) return filtered;
  return filterInlineSuppressions(filtered, directory, readFileLinesSync);
};
