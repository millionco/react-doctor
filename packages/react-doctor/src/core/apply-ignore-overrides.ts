import type { ReactDoctorConfig, ReactDoctorIgnoreOverride } from "../types/config.js";
import type { Diagnostic } from "../types/diagnostic.js";
import { isPlainObject } from "./is-plain-object.js";
import { compileGlobPattern } from "./match-glob-pattern.js";
import { toRelativePath } from "./to-relative-path.js";

interface CompiledIgnoreOverride {
  filePatterns: RegExp[];
  ruleIds: ReadonlySet<string>;
}

const warnConfigField = (message: string): void => {
  process.stderr.write(`[react-doctor] ${message}\n`);
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const collectStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const validateOverrideEntry = (entry: unknown, index: number): ReactDoctorIgnoreOverride | null => {
  if (!isPlainObject(entry)) {
    warnConfigField(
      `ignore.overrides[${index}] must be an object with { files, rules }; ignoring this entry.`,
    );
    return null;
  }
  if (!isStringArray(entry.files)) {
    warnConfigField(
      `ignore.overrides[${index}].files must be an array of strings; ignoring this entry.`,
    );
    return null;
  }
  if (entry.rules !== undefined && !isStringArray(entry.rules)) {
    warnConfigField(
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
    warnConfigField(`ignore.overrides must be an array of { files, rules } entries; ignoring.`);
    return [];
  }

  return overrides.flatMap((entry, index) => {
    const validated = validateOverrideEntry(entry, index);
    if (!validated) return [];
    const filePatterns = collectStringList(validated.files).map(compileGlobPattern);
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
