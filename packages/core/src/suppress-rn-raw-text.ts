import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";

const OPENING_TAG_PATTERN = /<([A-Z][\w.]*)/;
const JSX_CHILD_OPEN_PATTERN = /<[A-Za-z]/;

const escapeRegExpSpecials = (rawText: string): string =>
  rawText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

interface CreateRnRawTextSuppressorInput {
  readonly config: ReactDoctorConfig | null;
  readonly getFileLines: (filePath: string) => string[] | null;
}

const leafTagName = (tagName: string): string =>
  tagName.includes(".") ? (tagName.split(".").at(-1) ?? tagName) : tagName;

const isInsideTextComponent = (
  lines: string[],
  diagnosticLine: number,
  textComponentNames: ReadonlySet<string>,
): boolean => {
  for (let lineIndex = diagnosticLine - 1; lineIndex >= 0; lineIndex--) {
    const match = lines[lineIndex].match(OPENING_TAG_PATTERN);
    if (!match) continue;
    const fullTagName = match[1];
    return textComponentNames.has(fullTagName) || textComponentNames.has(leafTagName(fullTagName));
  }
  return false;
};

const findOpenerAtOrAbove = (lines: string[], upperBoundLineIndex: number): JsxOpener | null => {
  for (let lineIndex = upperBoundLineIndex; lineIndex >= 0; lineIndex--) {
    const match = lines[lineIndex].match(OPENING_TAG_PATTERN);
    if (!match) continue;
    const fullName = match[1];
    return { fullName, leafName: leafTagName(fullName), lineIndex };
  }
  return null;
};

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

const isInsideStringOnlyWrapper = (
  lines: string[],
  diagnosticLine: number,
  diagnosticColumn: number,
  wrapperNames: ReadonlySet<string>,
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

export const createRnRawTextSuppressor = (
  input: CreateRnRawTextSuppressorInput,
): ((diagnostic: Diagnostic) => boolean) => {
  const { config, getFileLines } = input;
  const textComponentNames = new Set(
    Array.isArray(config?.textComponents)
      ? config.textComponents.filter((name): name is string => typeof name === "string")
      : [],
  );
  const rawTextWrapperComponentNames = new Set(
    Array.isArray(config?.rawTextWrapperComponents)
      ? config.rawTextWrapperComponents.filter((name): name is string => typeof name === "string")
      : [],
  );
  const hasTextComponents = textComponentNames.size > 0;
  const hasRawTextWrappers = rawTextWrapperComponentNames.size > 0;

  if (!hasTextComponents && !hasRawTextWrappers) return () => false;

  return (diagnostic) => {
    if (diagnostic.rule !== "rn-no-raw-text" || diagnostic.line <= 0) return false;

    const lines = getFileLines(diagnostic.filePath);
    if (!lines) return false;

    if (hasTextComponents && isInsideTextComponent(lines, diagnostic.line, textComponentNames)) {
      return true;
    }
    return (
      hasRawTextWrappers &&
      isInsideStringOnlyWrapper(
        lines,
        diagnostic.line,
        diagnostic.column,
        rawTextWrapperComponentNames,
      )
    );
  };
};
