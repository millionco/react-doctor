import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import { applySeverityControls } from "./apply-severity-controls.js";
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
    // `migration-hint` wins over `test-noise` — deprecated API usage
    // in test code is the very surface that needs migration (e.g.
    // `react-dom/test-utils` imports in `.test.tsx` files). Keep the
    // diagnostic regardless of the file's test-iness.
    if (rule.tags.includes("migration-hint")) return false;
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
  const severityAdjusted = applySeverityControls(autoFiltered, userConfig);
  const filtered = userConfig
    ? filterIgnoredDiagnostics(severityAdjusted, userConfig, directory, readFileLinesSync)
    : severityAdjusted;
  if (options.respectInlineDisables === false) return filtered;
  return filterInlineSuppressions(filtered, directory, readFileLinesSync);
};
