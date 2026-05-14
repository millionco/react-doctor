import type { ReactDoctorConfig } from "../../types/config.js";
import type { Diagnostic } from "../../types/diagnostic.js";
import {
  compileIgnoreOverrides,
  isDiagnosticIgnoredByOverrides,
} from "./apply-ignore-overrides.js";
import { evaluateSuppression } from "./evaluate-suppression.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "../config/is-ignored-file.js";

const OPENING_TAG_PATTERN = /<([A-Z][\w.]*)/;
const JSX_CHILD_OPEN_PATTERN = /<[A-Za-z]/;

const escapeRegExpSpecials = (rawText: string): string =>
  rawText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

interface JsxOpener {
  fullName: string;
  leafName: string;
  lineIndex: number;
}

interface ResolvedJsxRange {
  closerLineIndex: number;
  closerColumn: number;
  bodyText: string;
}

const findOpenerAtOrAbove = (lines: string[], upperBoundLineIndex: number): JsxOpener | null => {
  for (let lineIndex = upperBoundLineIndex; lineIndex >= 0; lineIndex--) {
    const match = lines[lineIndex].match(OPENING_TAG_PATTERN);
    if (!match) continue;
    const fullName = match[1];
    const leafName = fullName.includes(".") ? (fullName.split(".").at(-1) ?? fullName) : fullName;
    return { fullName, leafName, lineIndex };
  }
  return null;
};

// Resolves the inner-body text of a JSX element starting at `opener`,
// plus the position of its matching closing tag. Heuristic — operates
// on raw lines without an AST — but good enough to (a) distinguish
// "wrapper holds only stringifiable children" from "wrapper also
// holds a JSX child element", and (b) verify the opener actually
// encloses a given diagnostic position (vs. being a closed sibling).
//
// Returns `null` when we couldn't confidently locate the element's
// closing tag or body (no matching `</Tag>`, opening `>` missing on
// its own line, self-closing tag, etc.). Callers should treat `null`
// as "this opener can't enclose anything we care about" and walk
// further up.
const resolveJsxRange = (lines: string[], opener: JsxOpener): ResolvedJsxRange | null => {
  const closingPattern = new RegExp(
    `</(?:${escapeRegExpSpecials(opener.fullName)}|${escapeRegExpSpecials(opener.leafName)})\\s*>`,
  );

  let closerLineIndex = -1;
  let closerColumn = -1;
  for (let lineIndex = opener.lineIndex; lineIndex < lines.length; lineIndex++) {
    const match = closingPattern.exec(lines[lineIndex]);
    if (!match) continue;
    closerLineIndex = lineIndex;
    closerColumn = match.index;
    break;
  }
  if (closerLineIndex < 0) return null;

  const openerLine = lines[opener.lineIndex];
  const tagStartIndex = openerLine.indexOf(`<${opener.fullName}`);
  if (tagStartIndex < 0) return null;
  const openerEndIndex = openerLine.indexOf(">", tagStartIndex);

  let bodyText: string;
  if (opener.lineIndex === closerLineIndex) {
    if (openerEndIndex < 0 || openerEndIndex >= closerColumn) return null;
    bodyText = openerLine.slice(openerEndIndex + 1, closerColumn);
  } else {
    const segments: string[] = [];
    if (openerEndIndex >= 0) segments.push(openerLine.slice(openerEndIndex + 1));
    for (let lineIndex = opener.lineIndex + 1; lineIndex < closerLineIndex; lineIndex++) {
      segments.push(lines[lineIndex]);
    }
    segments.push(lines[closerLineIndex].slice(0, closerColumn));
    bodyText = segments.join("\n");
  }

  return { closerLineIndex, closerColumn, bodyText };
};

// Iterates openers from nearest-above the diagnostic outward, skipping
// those whose closing tag falls BEFORE the diagnostic position (those
// are closed siblings, not enclosing parents). Returns `true` when the
// nearest actually-enclosing opener is in `wrapperNames` AND its body
// has no JSX child elements.
//
// Diagnostic line and column are 1-indexed; column may be 0 when
// oxlint omits the span (we treat that as "earliest position on the
// line", which is conservative for enclosure checks).
const isInsideStringOnlyWrapper = (
  lines: string[],
  diagnosticLine: number,
  diagnosticColumn: number,
  wrapperNames: Set<string>,
): boolean => {
  const diagnosticLineIndex = diagnosticLine - 1;
  const diagnosticColumnIndex = Math.max(0, diagnosticColumn - 1);
  let upperBoundLineIndex = diagnosticLineIndex;

  while (upperBoundLineIndex >= 0) {
    const opener = findOpenerAtOrAbove(lines, upperBoundLineIndex);
    if (!opener) return false;

    const range = resolveJsxRange(lines, opener);
    if (range === null) {
      upperBoundLineIndex = opener.lineIndex - 1;
      continue;
    }

    const isClosedBeforeDiagnostic =
      range.closerLineIndex < diagnosticLineIndex ||
      (range.closerLineIndex === diagnosticLineIndex &&
        range.closerColumn <= diagnosticColumnIndex);
    if (isClosedBeforeDiagnostic) {
      upperBoundLineIndex = opener.lineIndex - 1;
      continue;
    }

    if (!wrapperNames.has(opener.fullName) && !wrapperNames.has(opener.leafName)) return false;
    return !JSX_CHILD_OPEN_PATTERN.test(range.bodyText);
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
  const rawTextWrapperComponentNames = new Set(
    Array.isArray(config.rawTextWrapperComponents)
      ? config.rawTextWrapperComponents.filter((name): name is string => typeof name === "string")
      : [],
  );
  const hasRawTextWrappers = rawTextWrapperComponentNames.size > 0;
  const getFileLines = createFileLinesCache(rootDirectory, readFileLinesSync);

  return diagnostics.filter((diagnostic) => {
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (ignoredRules.has(ruleIdentifier)) return false;
    if (isFileIgnoredByPatterns(diagnostic.filePath, rootDirectory, ignoredFilePatterns)) {
      return false;
    }
    if (isDiagnosticIgnoredByOverrides(diagnostic, rootDirectory, compiledOverrides)) return false;

    if (
      (hasTextComponents || hasRawTextWrappers) &&
      diagnostic.rule === "rn-no-raw-text" &&
      diagnostic.line > 0
    ) {
      const lines = getFileLines(diagnostic.filePath);
      if (lines) {
        if (
          hasTextComponents &&
          isInsideTextComponent(lines, diagnostic.line, textComponentNames)
        ) {
          return false;
        }
        if (
          hasRawTextWrappers &&
          isInsideStringOnlyWrapper(
            lines,
            diagnostic.line,
            diagnostic.column,
            rawTextWrapperComponentNames,
          )
        ) {
          return false;
        }
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
