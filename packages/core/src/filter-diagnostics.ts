import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import {
  compileIgnoreOverrides,
  isDiagnosticIgnoredByOverrides,
} from "./apply-ignore-overrides.js";
import { evaluateSuppression } from "./evaluate-suppression.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";
import { isSameRuleKey } from "./rule-key-aliases.js";

export const resolveCandidateReadPath = (rootDirectory: string, filePath: string): string => {
  const normalizedFile = filePath.replace(/\\/g, "/");
  if (
    normalizedFile.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalizedFile) ||
    /^[a-zA-Z]:\\/.test(filePath)
  ) {
    return filePath;
  }
  const root = rootDirectory.replace(/\\/g, "/").replace(/\/$/, "");
  return `${root}/${normalizedFile.replace(/^\.\//, "")}`;
};

const createFileLinesCache = (
  rootDirectory: string,
  readFileLinesSync: (filePath: string) => string[] | null,
) => {
  const cache = new Map<string, string[] | null>();

  return (filePath: string): string[] | null => {
    const cached = cache.get(filePath);
    if (cached !== undefined) return cached;
    const absolutePath = resolveCandidateReadPath(rootDirectory, filePath);
    const lines = readFileLinesSync(absolutePath);
    cache.set(filePath, lines);
    return lines;
  };
};

const isIgnoredRule = (ignoredRules: ReadonlySet<string>, ruleIdentifier: string): boolean => {
  for (const ignoredRule of ignoredRules) {
    if (isSameRuleKey(ignoredRule, ruleIdentifier)) return true;
  }
  return false;
};

export const filterIgnoredDiagnostics = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig,
  rootDirectory: string,
  readFileLinesSync: (filePath: string) => string[] | null,
): Diagnostic[] => {
  const ignoredRules = new Set(
    Array.isArray(config.ignore?.rules)
      ? config.ignore.rules.filter((rule): rule is string => typeof rule === "string")
      : [],
  );
  const ignoredFilePatterns = compileIgnoredFilePatterns(config);
  const compiledOverrides = compileIgnoreOverrides(config);

  return diagnostics.filter((diagnostic) => {
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (isIgnoredRule(ignoredRules, ruleIdentifier)) return false;
    if (isFileIgnoredByPatterns(diagnostic.filePath, rootDirectory, ignoredFilePatterns)) {
      return false;
    }
    if (isDiagnosticIgnoredByOverrides(diagnostic, rootDirectory, compiledOverrides)) return false;

    return true;
  });
};

export const filterInlineSuppressions = (
  diagnostics: Diagnostic[],
  rootDirectory: string,
  readFileLinesSync: (filePath: string) => string[] | null,
): Diagnostic[] => {
  const getFileLines = createFileLinesCache(rootDirectory, readFileLinesSync);

  return diagnostics.flatMap((diagnostic) => {
    if (diagnostic.line <= 0) return [diagnostic];

    const lines = getFileLines(diagnostic.filePath);
    if (!lines) return [diagnostic];

    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    const diagnosticLineIndex = diagnostic.line - 1;

    const evaluation = evaluateSuppression(lines, diagnosticLineIndex, ruleIdentifier);
    if (evaluation.isSuppressed) return [];
    return evaluation.nearMissHint
      ? [{ ...diagnostic, suppressionHint: evaluation.nearMissHint }]
      : [diagnostic];
  });
};
