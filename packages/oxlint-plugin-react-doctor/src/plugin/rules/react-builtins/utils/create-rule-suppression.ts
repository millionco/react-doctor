import { readFileSync } from "node:fs";

const DISABLE_NEXT_LINE_PATTERN = /\b(?:eslint|oxlint)-disable-next-line\b([^\n]*)/;
const DISABLE_SAME_LINE_PATTERN = /\b(?:eslint|oxlint)-disable-line\b([^\n]*)/;

interface SuppressionIndex {
  suppressedLines: ReadonlySet<number>;
  utf16NewlineOffsets: ReadonlyArray<number>;
  utf8NewlineOffsets: ReadonlyArray<number>;
}

interface RuleSuppression {
  isSuppressedAt: (filename: string | undefined, nodeStartOffset: number | null) => boolean;
  clearCache: () => void;
}

interface NewlineOffsets {
  utf16: ReadonlyArray<number>;
  utf8: ReadonlyArray<number>;
}

const collectSuppressedLines = (sourceText: string, ruleNamePattern: RegExp): Set<number> => {
  const suppressedLines = new Set<number>();
  const lines = sourceText.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (!line.includes("-disable")) continue;
    const nextLineMatch = DISABLE_NEXT_LINE_PATTERN.exec(line);
    if (nextLineMatch && ruleNamePattern.test(nextLineMatch[1] ?? "")) {
      suppressedLines.add(lineIndex + 2);
      continue;
    }
    const sameLineMatch = DISABLE_SAME_LINE_PATTERN.exec(line);
    if (sameLineMatch && ruleNamePattern.test(sameLineMatch[1] ?? "")) {
      suppressedLines.add(lineIndex + 1);
    }
  }
  return suppressedLines;
};

const collectNewlineOffsets = (sourceText: string): NewlineOffsets => {
  const utf16NewlineOffsets: number[] = [];
  const utf8NewlineOffsets: number[] = [];
  let utf8Offset = 0;
  let sliceStart = 0;
  for (let characterIndex = 0; characterIndex < sourceText.length; characterIndex++) {
    if (sourceText[characterIndex] !== "\n") continue;
    utf16NewlineOffsets.push(characterIndex);
    utf8Offset += Buffer.byteLength(sourceText.slice(sliceStart, characterIndex + 1), "utf8");
    utf8NewlineOffsets.push(utf8Offset - 1);
    sliceStart = characterIndex + 1;
  }
  return { utf16: utf16NewlineOffsets, utf8: utf8NewlineOffsets };
};

const buildSuppressionIndex = (
  sourceText: string,
  ruleNamePattern: RegExp,
): SuppressionIndex | null => {
  const suppressedLines = collectSuppressedLines(sourceText, ruleNamePattern);
  if (suppressedLines.size === 0) return null;

  const newlineOffsets = collectNewlineOffsets(sourceText);
  return {
    suppressedLines,
    utf16NewlineOffsets: newlineOffsets.utf16,
    utf8NewlineOffsets: newlineOffsets.utf8,
  };
};

const lineForOffset = (offset: number, newlineOffsets: ReadonlyArray<number>): number => {
  let lowIndex = 0;
  let highIndex = newlineOffsets.length - 1;
  let newlinesBefore = 0;
  while (lowIndex <= highIndex) {
    const middleIndex = Math.floor((lowIndex + highIndex) / 2);
    if (newlineOffsets[middleIndex]! < offset) {
      newlinesBefore = middleIndex + 1;
      lowIndex = middleIndex + 1;
    } else {
      highIndex = middleIndex - 1;
    }
  }
  return newlinesBefore + 1;
};

export const createRuleSuppression = (ruleName: string): RuleSuppression => {
  const ruleNamePattern = new RegExp(`(?:^|[\\s,/])${ruleName}(?:$|[\\s,:])`);
  const suppressionIndexCache = new Map<string, SuppressionIndex | null>();

  const getSuppressionIndex = (filename: string | undefined): SuppressionIndex | null => {
    if (!filename) return null;
    const cachedIndex = suppressionIndexCache.get(filename);
    if (cachedIndex !== undefined) return cachedIndex;

    let suppressionIndex: SuppressionIndex | null = null;
    try {
      suppressionIndex = buildSuppressionIndex(readFileSync(filename, "utf8"), ruleNamePattern);
    } catch {
      suppressionIndex = null;
    }
    suppressionIndexCache.set(filename, suppressionIndex);
    return suppressionIndex;
  };

  return {
    clearCache: () => suppressionIndexCache.clear(),
    isSuppressedAt: (filename, nodeStartOffset) => {
      if (nodeStartOffset === null) return false;
      const suppressionIndex = getSuppressionIndex(filename);
      if (!suppressionIndex) return false;
      return (
        suppressionIndex.suppressedLines.has(
          lineForOffset(nodeStartOffset, suppressionIndex.utf16NewlineOffsets),
        ) ||
        suppressionIndex.suppressedLines.has(
          lineForOffset(nodeStartOffset, suppressionIndex.utf8NewlineOffsets),
        )
      );
    },
  };
};
