import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { compileGlobPattern } from "./match-glob-pattern.js";

export const filterIgnoredDiagnostics = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig,
): Diagnostic[] => {
  const ignoredRules = new Set(Array.isArray(config.ignore?.rules) ? config.ignore.rules : []);
  const ignoredFilePatterns = Array.isArray(config.ignore?.files)
    ? config.ignore.files.map(compileGlobPattern)
    : [];

  if (ignoredRules.size === 0 && ignoredFilePatterns.length === 0) {
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

    return true;
  });
};

const DISABLE_NEXT_LINE_PATTERN = /\/\/\s*react-doctor-disable-next-line\b(?:\s+(.+))?/;
const DISABLE_LINE_PATTERN = /\/\/\s*react-doctor-disable-line\b(?:\s+(.+))?/;

const isRuleSuppressed = (commentRules: string | undefined, ruleId: string): boolean => {
  if (!commentRules?.trim()) return true;
  return commentRules.split(/[,\s]+/).some((rule) => rule.trim() === ruleId);
};

export const filterInlineSuppressions = (
  diagnostics: Diagnostic[],
  rootDirectory: string,
): Diagnostic[] => {
  const fileLineCache = new Map<string, string[] | null>();

  const getFileLines = (filePath: string): string[] | null => {
    const cached = fileLineCache.get(filePath);
    if (cached !== undefined) return cached;
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootDirectory, filePath);
    try {
      const lines = fs.readFileSync(absolutePath, "utf-8").split("\n");
      fileLineCache.set(filePath, lines);
      return lines;
    } catch {
      fileLineCache.set(filePath, null);
      return null;
    }
  };

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
      const prevLine = lines[diagnostic.line - 2];
      if (prevLine) {
        const nextLineMatch = prevLine.match(DISABLE_NEXT_LINE_PATTERN);
        if (nextLineMatch && isRuleSuppressed(nextLineMatch[1], ruleId)) return false;
      }
    }

    return true;
  });
};
