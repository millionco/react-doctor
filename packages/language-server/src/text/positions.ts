import type { Position, Range } from "vscode-languageserver";

/**
 * oxlint reports spans as UTF-8 **byte** offsets, but LSP positions are
 * UTF-16 code-unit based. These helpers convert between the two using
 * the actual document text so squiggles land exactly on the offending
 * token even when a line contains multi-byte characters.
 */

const utf8ByteLength = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const utf16UnitLength = (codePoint: number): number => (codePoint > 0xffff ? 2 : 1);

/**
 * Converts a UTF-8 byte offset into a 0-indexed LSP `Position`. Walks
 * the text by code point, accumulating byte and line/character counts.
 * A target past the end clamps to the final position.
 */
export const byteOffsetToPosition = (text: string, byteOffset: number): Position => {
  if (byteOffset <= 0) return { line: 0, character: 0 };

  let byteCount = 0;
  let line = 0;
  let character = 0;

  for (const char of text) {
    if (byteCount >= byteOffset) return { line, character };
    if (char === "\n") {
      line += 1;
      character = 0;
      byteCount += 1;
      continue;
    }
    const codePoint = char.codePointAt(0) ?? 0;
    byteCount += utf8ByteLength(codePoint);
    character += utf16UnitLength(codePoint);
  }

  return { line, character };
};

/** Builds an LSP `Range` from a UTF-8 byte span against the document text. */
export const rangeFromByteSpan = (text: string, offset: number, length: number): Range => ({
  start: byteOffsetToPosition(text, offset),
  end: byteOffsetToPosition(text, offset + Math.max(0, length)),
});

/**
 * Fallback range from oxlint's 1-indexed `line` / `column` when no byte
 * span is available (environment / dead-code diagnostics). When the
 * document text is known, the range extends to the end of the token's
 * line so the squiggle is visible; otherwise it spans a single column.
 */
export const rangeFromLineColumn = (text: string | null, line: number, column: number): Range => {
  const startLine = Math.max(0, (line || 1) - 1);
  const startCharacter = Math.max(0, (column || 1) - 1);
  const start: Position = { line: startLine, character: startCharacter };

  if (text !== null) {
    const lines = text.split("\n");
    const lineText = lines[startLine] ?? "";
    const endCharacter = Math.max(startCharacter + 1, lineText.replace(/\r$/, "").length);
    return { start, end: { line: startLine, character: endCharacter } };
  }

  return { start, end: { line: startLine, character: startCharacter + 1 } };
};

/**
 * Whether `position` falls within `range`. The end is exclusive, matching
 * LSP range semantics (so the cursor one unit past the underline is not a
 * match) — except a zero-width range still matches at its single point so
 * a collapsed diagnostic span stays hoverable.
 */
export const isPositionInRange = (range: Range, position: Position): boolean => {
  const afterStart =
    position.line > range.start.line ||
    (position.line === range.start.line && position.character >= range.start.character);
  const beforeEnd =
    position.line < range.end.line ||
    (position.line === range.end.line && position.character < range.end.character);
  const atZeroWidthRange =
    range.start.line === range.end.line &&
    range.start.character === range.end.character &&
    position.line === range.start.line &&
    position.character === range.start.character;
  return (afterStart && beforeEnd) || atZeroWidthRange;
};

const isBefore = (first: Position, second: Position): boolean =>
  first.line < second.line || (first.line === second.line && first.character < second.character);

/** Whether two ranges overlap (touching endpoints count as overlap). */
export const rangesOverlap = (first: Range, second: Range): boolean =>
  !isBefore(first.end, second.start) && !isBefore(second.end, first.start);
