import { readFileSync } from "node:fs";

// Codebases that migrated from eslint-plugin-react-hooks carry
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments on
// deliberately mount-only effects. The rule's own docs point authors at
// linter suppressions for intentional exclusions, so honoring the
// upstream rule name (which oxlint's own disable-comment handling does
// NOT match against our `react-doctor/exhaustive-deps` id) keeps those
// documented opt-outs working instead of re-reporting them.
const DISABLE_COMMENT_RULE_NAME_PATTERN = /(?:^|[\s,/])exhaustive-deps(?:$|[\s,:])/;
const DISABLE_NEXT_LINE_PATTERN = /\b(?:eslint|oxlint)-disable-next-line\b([^\n]*)/;
const DISABLE_SAME_LINE_PATTERN = /\b(?:eslint|oxlint)-disable-line\b([^\n]*)/;

interface SuppressionIndex {
  suppressedLines: ReadonlySet<number>;
  utf16NewlineOffsets: ReadonlyArray<number>;
  utf8NewlineOffsets: ReadonlyArray<number>;
}

const suppressionIndexCache = new Map<string, SuppressionIndex | null>();

const namesExhaustiveDeps = (ruleList: string | undefined): boolean =>
  typeof ruleList === "string" && DISABLE_COMMENT_RULE_NAME_PATTERN.test(ruleList);

const buildSuppressionIndex = (sourceText: string): SuppressionIndex | null => {
  const suppressedLines = new Set<number>();
  const lines = sourceText.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (!line.includes("-disable")) continue;
    const nextLineMatch = DISABLE_NEXT_LINE_PATTERN.exec(line);
    if (nextLineMatch && namesExhaustiveDeps(nextLineMatch[1])) {
      suppressedLines.add(lineIndex + 2);
      continue;
    }
    const sameLineMatch = DISABLE_SAME_LINE_PATTERN.exec(line);
    if (sameLineMatch && namesExhaustiveDeps(sameLineMatch[1])) {
      suppressedLines.add(lineIndex + 1);
    }
  }
  if (suppressedLines.size === 0) return null;
  // Host ASTs disagree on span units (oxlint raw-transfer spans are
  // UTF-8 byte offsets; the ESLint adapter and test harness use UTF-16
  // string indices), so record newline positions in BOTH units and let
  // the lookup accept either interpretation. Suppression additionally
  // requires the explicit rule-name comment, so a dual match can only
  // widen an author-requested opt-out, never hide an unrelated report.
  const utf16NewlineOffsets: number[] = [];
  const utf8NewlineOffsets: number[] = [];
  let utf8Offset = 0;
  let sliceStart = 0;
  for (let charIndex = 0; charIndex < sourceText.length; charIndex++) {
    if (sourceText[charIndex] !== "\n") continue;
    utf16NewlineOffsets.push(charIndex);
    utf8Offset += Buffer.byteLength(sourceText.slice(sliceStart, charIndex + 1), "utf8");
    utf8NewlineOffsets.push(utf8Offset - 1);
    sliceStart = charIndex + 1;
  }
  return { suppressedLines, utf16NewlineOffsets, utf8NewlineOffsets };
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

const getSuppressionIndex = (filename: string | undefined): SuppressionIndex | null => {
  if (!filename) return null;
  const cached = suppressionIndexCache.get(filename);
  if (cached !== undefined) return cached;
  let index: SuppressionIndex | null = null;
  try {
    index = buildSuppressionIndex(readFileSync(filename, "utf8"));
  } catch {
    index = null;
  }
  suppressionIndexCache.set(filename, index);
  return index;
};

export const isExhaustiveDepsSuppressedAt = (
  filename: string | undefined,
  nodeStartOffset: number | null,
): boolean => {
  if (nodeStartOffset === null) return false;
  const index = getSuppressionIndex(filename);
  if (!index) return false;
  return (
    index.suppressedLines.has(lineForOffset(nodeStartOffset, index.utf16NewlineOffsets)) ||
    index.suppressedLines.has(lineForOffset(nodeStartOffset, index.utf8NewlineOffsets))
  );
};

export const clearExhaustiveDepsSuppressionCache = (): void => {
  suppressionIndexCache.clear();
};
