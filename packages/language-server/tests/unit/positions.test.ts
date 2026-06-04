import { describe, expect, it } from "vite-plus/test";
import {
  byteOffsetToPosition,
  isPositionInRange,
  rangeFromByteSpan,
  rangeFromLineColumn,
  rangesOverlap,
} from "../../src/text/positions.js";

describe("byteOffsetToPosition", () => {
  it("maps offset 0 to the document start", () => {
    expect(byteOffsetToPosition("const value = 1;", 0)).toEqual({ line: 0, character: 0 });
  });

  it("lands on the next line at character 0 for an offset just past a newline", () => {
    const text = "first\nsecond";
    const secondLineByteOffset = Buffer.byteLength("first\n", "utf8");
    expect(byteOffsetToPosition(text, secondLineByteOffset)).toEqual({ line: 1, character: 0 });
  });

  it("treats a multi-byte character as one UTF-16 unit (byte offset != character)", () => {
    const text = 'const x = "café";';
    const closingQuoteCharIndex = text.lastIndexOf('"');
    const closingQuoteByteOffset = Buffer.byteLength(text.slice(0, closingQuoteCharIndex), "utf8");
    const position = byteOffsetToPosition(text, closingQuoteByteOffset);

    expect(position).toEqual({ line: 0, character: closingQuoteCharIndex });
    expect(closingQuoteByteOffset).toBeGreaterThan(position.character);
  });
});

describe("rangeFromByteSpan", () => {
  it("produces a same-line range whose end character is past the start", () => {
    const text = "const value = 1;";
    const valueByteOffset = Buffer.byteLength("const ", "utf8");
    const range = rangeFromByteSpan(text, valueByteOffset, "value".length);

    expect(range.start).toEqual({ line: 0, character: 6 });
    expect(range.end.line).toBe(range.start.line);
    expect(range.end.character).toBeGreaterThan(range.start.character);
  });
});

describe("rangeFromLineColumn", () => {
  it("converts 1-indexed line/column to a single-character 0-indexed range without text", () => {
    expect(rangeFromLineColumn(null, 9, 13)).toEqual({
      start: { line: 8, character: 12 },
      end: { line: 8, character: 13 },
    });
  });

  it("extends the end to the end of the target line when text is provided", () => {
    const text = "alpha\nconst beta = 2;\ngamma";
    const range = rangeFromLineColumn(text, 2, 7);

    expect(range.start).toEqual({ line: 1, character: 6 });
    expect(range.end.character).toBe("const beta = 2;".length);
  });
});

describe("isPositionInRange", () => {
  const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 10 } };

  it("returns true for a position inside the range", () => {
    expect(isPositionInRange(range, { line: 1, character: 5 })).toBe(true);
  });

  it("returns false for a position outside the range", () => {
    expect(isPositionInRange(range, { line: 1, character: 11 })).toBe(false);
    expect(isPositionInRange(range, { line: 0, character: 5 })).toBe(false);
  });

  it("treats the start as inclusive and the end as exclusive (LSP semantics)", () => {
    expect(isPositionInRange(range, { line: 1, character: 2 })).toBe(true); // start
    expect(isPositionInRange(range, { line: 1, character: 10 })).toBe(false); // end (exclusive)
  });

  it("still matches a zero-width range at its single point", () => {
    const empty = { start: { line: 3, character: 4 }, end: { line: 3, character: 4 } };
    expect(isPositionInRange(empty, { line: 3, character: 4 })).toBe(true);
    expect(isPositionInRange(empty, { line: 3, character: 5 })).toBe(false);
  });
});

describe("rangesOverlap", () => {
  it("treats touching endpoints as overlapping", () => {
    const first = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
    const second = { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } };
    expect(rangesOverlap(first, second)).toBe(true);
  });

  it("returns false for disjoint ranges", () => {
    const first = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
    const second = { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } };
    expect(rangesOverlap(first, second)).toBe(false);
  });
});
