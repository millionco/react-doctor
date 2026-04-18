import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";

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

const OPENING_TAG_PATTERN = /<([A-Z][\w.]*)/;
const DISABLE_NEXT_LINE_PATTERN = /\/\/\s*react-doctor-disable-next-line\b(?:\s+(.+))?/;
const DISABLE_LINE_PATTERN = /\/\/\s*react-doctor-disable-line\b(?:\s+(.+))?/;

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

const isRuleSuppressed = (commentRules: string | undefined, ruleId: string): boolean => {
  if (!commentRules?.trim()) return true;
  return commentRules.split(/[,\s]+/).some((rule) => rule.trim() === ruleId);
};

export const filterIgnoredDiagnostics = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig,
  rootDirectory: string,
  readFileLinesSync: (filePath: string) => string[] | null,
): Diagnostic[] => {
  const ignoredRules = new Set(Array.isArray(config.ignore?.rules) ? config.ignore.rules : []);
  const ignoredFilePatterns = compileIgnoredFilePatterns(config);
  const textComponentNames = new Set(
    Array.isArray(config.textComponents) ? config.textComponents : [],
  );
  const hasTextComponents = textComponentNames.size > 0;
  const getFileLines = createFileLinesCache(rootDirectory, readFileLinesSync);

  return diagnostics.filter((diagnostic) => {
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (ignoredRules.has(ruleIdentifier)) {
      return false;
    }

    if (isFileIgnoredByPatterns(diagnostic.filePath, rootDirectory, ignoredFilePatterns)) {
      return false;
    }

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

  return diagnostics.filter((diagnostic) => {
    if (diagnostic.line <= 0) return true;

    const lines = getFileLines(diagnostic.filePath);
    if (!lines) return true;

    const ruleId = `${diagnostic.plugin}/${diagnostic.rule}`;

    const currentLine = lines[diagnostic.line - 1];
    if (currentLine) {
      const lineMatch = currentLine.match(DISABLE_LINE_PATTERN);
      if (lineMatch && isRuleSuppressed(lineMatch[1], ruleId)) return false;
    }

    if (diagnostic.line >= 2) {
      const previousLine = lines[diagnostic.line - 2];
      if (previousLine) {
        const nextLineMatch = previousLine.match(DISABLE_NEXT_LINE_PATTERN);
        if (nextLineMatch && isRuleSuppressed(nextLineMatch[1], ruleId)) return false;
      }
    }

    return true;
  });
};
