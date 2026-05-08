import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import {
  compileIgnoreOverrides,
  isDiagnosticIgnoredByOverrides,
} from "./apply-ignore-overrides.js";
import { evaluateSuppression } from "./evaluate-suppression.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";

const OPENING_TAG_PATTERN = /<([A-Z][\w.]*)/;

const resolveCandidateReadPath = (rootDirectory: string, filePath: string): string => {
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

const isInsideTextComponent = (
  lines: string[],
  diagnosticLine: number,
  textComponentNames: Set<string>,
): boolean => {
  for (let lineIndex = diagnosticLine - 1; lineIndex >= 0; lineIndex--) {
    const match = lines[lineIndex].match(OPENING_TAG_PATTERN);
    if (!match) continue;
    const fullTagName = match[1];
    const leafTagName = fullTagName.includes(".")
      ? (fullTagName.split(".").at(-1) ?? fullTagName)
      : fullTagName;
    return textComponentNames.has(fullTagName) || textComponentNames.has(leafTagName);
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
  const textComponentNames = new Set(
    Array.isArray(config.textComponents)
      ? config.textComponents.filter((name): name is string => typeof name === "string")
      : [],
  );
  const hasTextComponents = textComponentNames.size > 0;
  const getFileLines = createFileLinesCache(rootDirectory, readFileLinesSync);

  return diagnostics.filter((diagnostic) => {
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (ignoredRules.has(ruleIdentifier)) return false;
    if (isFileIgnoredByPatterns(diagnostic.filePath, rootDirectory, ignoredFilePatterns)) {
      return false;
    }
    if (isDiagnosticIgnoredByOverrides(diagnostic, rootDirectory, compiledOverrides)) return false;

    if (hasTextComponents && diagnostic.rule === "rn-no-raw-text" && diagnostic.line > 0) {
      const lines = getFileLines(diagnostic.filePath);
      if (lines && isInsideTextComponent(lines, diagnostic.line, textComponentNames)) {
        return false;
      }
    }

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
