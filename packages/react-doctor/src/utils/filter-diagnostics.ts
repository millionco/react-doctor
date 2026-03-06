import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { compileGlobPattern } from "./match-glob-pattern.js";

interface CompiledOverride {
  filePatterns: RegExp[];
  ignoredRules: Set<string>;
}

const compileOverrides = (config: ReactDoctorConfig): CompiledOverride[] => {
  if (!Array.isArray(config.overrides)) return [];

  return config.overrides.map((override) => ({
    filePatterns: override.files.map(compileGlobPattern),
    ignoredRules: new Set(override.ignore.rules),
  }));
};

const isRuleIgnoredByOverride = (
  normalizedPath: string,
  ruleIdentifier: string,
  compiledOverrides: CompiledOverride[],
): boolean =>
  compiledOverrides.some(
    (override) =>
      override.ignoredRules.has(ruleIdentifier) &&
      override.filePatterns.some((pattern) => pattern.test(normalizedPath)),
  );

export const filterIgnoredDiagnostics = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig,
): Diagnostic[] => {
  const ignoredRules = new Set(Array.isArray(config.ignore?.rules) ? config.ignore.rules : []);
  const ignoredFilePatterns = Array.isArray(config.ignore?.files)
    ? config.ignore.files.map(compileGlobPattern)
    : [];
  const compiledOverrides = compileOverrides(config);

  const hasNoFilters =
    ignoredRules.size === 0 && ignoredFilePatterns.length === 0 && compiledOverrides.length === 0;

  if (hasNoFilters) {
    return diagnostics;
  }

  return diagnostics.filter((diagnostic) => {
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (ignoredRules.has(ruleIdentifier)) {
      return false;
    }

    const normalizedPath = diagnostic.filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (ignoredFilePatterns.some((pattern) => pattern.test(normalizedPath))) {
      return false;
    }

    if (isRuleIgnoredByOverride(normalizedPath, ruleIdentifier, compiledOverrides)) {
      return false;
    }

    return true;
  });
};
