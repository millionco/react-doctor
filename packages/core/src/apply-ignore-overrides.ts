import type { Diagnostic, ReactDoctorConfig, ReactDoctorIgnoreOverride } from "./types/index.js";
import { isPlainObject } from "./project-info/index.js";
import { compileGlobPatternsLenient } from "./utils/match-glob-pattern.js";
import { toRelativePath } from "./utils/to-relative-path.js";
import { warnConfigIssue } from "./utils/warn-config-issue.js";

interface CompiledIgnoreOverride {
  filePatterns: RegExp[];
  ruleIds: ReadonlySet<string>;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const collectStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const validateOverrideEntry = (entry: unknown, index: number): ReactDoctorIgnoreOverride | null => {
  if (!isPlainObject(entry)) {
    warnConfigIssue(
      `ignore.overrides[${index}] must be an object with { files, rules }; ignoring this entry.`,
    );
    return null;
  }
  if (!isStringArray(entry.files)) {
    warnConfigIssue(
      `ignore.overrides[${index}].files must be an array of strings; ignoring this entry.`,
    );
    return null;
  }
  if (entry.rules !== undefined && !isStringArray(entry.rules)) {
    warnConfigIssue(
      `ignore.overrides[${index}].rules must be an array of "plugin/rule" strings or omitted; treating as missing (override would suppress every rule for the matched files).`,
    );
    return { files: entry.files };
  }
  return entry.rules === undefined
    ? { files: entry.files }
    : { files: entry.files, rules: entry.rules };
};

export const compileIgnoreOverrides = (
  userConfig: ReactDoctorConfig | null,
): CompiledIgnoreOverride[] => {
  const overrides = userConfig?.ignore?.overrides;
  if (overrides === undefined) return [];
  if (!Array.isArray(overrides)) {
    warnConfigIssue(`ignore.overrides must be an array of { files, rules } entries; ignoring.`);
    return [];
  }

  return overrides.flatMap((entry, index) => {
    const validated = validateOverrideEntry(entry, index);
    if (!validated) return [];
    const filePatterns = compileGlobPatternsLenient(collectStringList(validated.files), (error) =>
      warnConfigIssue(`ignore.overrides[${index}]: ${error.message}`),
    );
    if (filePatterns.length === 0) return [];
    const ruleIds = new Set(collectStringList(validated.rules));
    return [{ filePatterns, ruleIds }];
  });
};

export const isDiagnosticIgnoredByOverrides = (
  diagnostic: Diagnostic,
  rootDirectory: string,
  overrides: CompiledIgnoreOverride[],
): boolean => {
  if (overrides.length === 0) return false;
  const relativeFilePath = toRelativePath(diagnostic.filePath, rootDirectory);
  const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;

  return overrides.some(
    (override) =>
      override.filePatterns.some((pattern) => pattern.test(relativeFilePath)) &&
      (override.ruleIds.size === 0 || override.ruleIds.has(ruleIdentifier)),
  );
};
