export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

interface ContentLineIndex {
  readonly content: string;
  readonly lineStartOffsets: ReadonlyArray<number>;
}

// Single-entry memo: the security scan is synchronous and processes one
// file's content at a time (per-match exec loops query the same string
// consecutively), so caching the last content's line index is enough and
// stays bounded — it holds at most one content string reference.
let lastContentLineIndex: ContentLineIndex | undefined;

const buildLineStartOffsets = (content: string): number[] => {
  const lineStartOffsets = [0];
  for (let characterIndex = 0; characterIndex < content.length; characterIndex += 1) {
    const character = content[characterIndex];
    if (character === "\r" && content[characterIndex + 1] === "\n") {
      characterIndex += 1;
      lineStartOffsets.push(characterIndex + 1);
      continue;
    }
    if (
      character === "\r" ||
      character === "\n" ||
      character === "\u2028" ||
      character === "\u2029"
    ) {
      lineStartOffsets.push(characterIndex + 1);
    }
  }
  return lineStartOffsets;
};

const getLineStartOffsets = (content: string): ReadonlyArray<number> => {
  if (lastContentLineIndex?.content === content) return lastContentLineIndex.lineStartOffsets;
  const lineStartOffsets = buildLineStartOffsets(content);
  lastContentLineIndex = { content, lineStartOffsets };
  return lineStartOffsets;
};

export const getLocationAtIndex = (content: string, matchIndex: number): SourceLocation => {
  if (Number.isNaN(matchIndex) || matchIndex < 0) return { line: 1, column: 1 };
  const lineStartOffsets = getLineStartOffsets(content);
  const boundedIndex = Math.min(Math.trunc(matchIndex), content.length);
  let lowLineIndex = 0;
  let highLineIndex = lineStartOffsets.length - 1;
  while (lowLineIndex < highLineIndex) {
    const midLineIndex = (lowLineIndex + highLineIndex + 1) >> 1;
    if (lineStartOffsets[midLineIndex] <= boundedIndex) {
      lowLineIndex = midLineIndex;
    } else {
      highLineIndex = midLineIndex - 1;
    }
  }
  return {
    line: lowLineIndex + 1,
    column: boundedIndex - lineStartOffsets[lowLineIndex] + 1,
  };
};
