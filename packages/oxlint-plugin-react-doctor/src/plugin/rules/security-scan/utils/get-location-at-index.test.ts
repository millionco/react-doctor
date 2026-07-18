import { describe, expect, it } from "vite-plus/test";
import type { SourceLocation } from "./get-location-at-index.js";
import { getLocationAtIndex } from "./get-location-at-index.js";

// Reference: the slice+split implementation whose outputs pin one-based
// line and column semantics for every ECMAScript line terminator.
const referenceLocationAtIndex = (content: string, matchIndex: number): SourceLocation => {
  if (matchIndex < 0) return { line: 1, column: 1 };
  const prefix = content.slice(0, matchIndex);
  const comparablePrefix =
    prefix.endsWith("\r") && content[matchIndex] === "\n" ? `${prefix.slice(0, -1)} ` : prefix;
  const lines = comparablePrefix.split(/\r\n|[\r\n\u2028\u2029]/);
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
};

describe("security-scan/utils/get-location-at-index", () => {
  it("reports line 1 column 1 at index 0", () => {
    expect(getLocationAtIndex("hello world", 0)).toEqual({ line: 1, column: 1 });
  });

  it("reports line 1 column 1 for a negative index", () => {
    expect(getLocationAtIndex("hello world", -1)).toEqual({ line: 1, column: 1 });
  });

  it("reports line 1 column 1 for a NaN index", () => {
    expect(getLocationAtIndex("ab\ncd", Number.NaN)).toEqual({ line: 1, column: 1 });
  });

  it("reports a 1-based column within the first line", () => {
    expect(getLocationAtIndex("hello world", 6)).toEqual({ line: 1, column: 7 });
  });

  it("locates an index on a later LF line", () => {
    expect(getLocationAtIndex("ab\ncd\nef", 4)).toEqual({ line: 2, column: 2 });
  });

  it("treats the index of a bare \\n as the end of its line", () => {
    expect(getLocationAtIndex("ab\ncd", 2)).toEqual({ line: 1, column: 3 });
  });

  it("starts a new line right after a bare \\n", () => {
    expect(getLocationAtIndex("ab\ncd", 3)).toEqual({ line: 2, column: 1 });
  });

  it("locates an index after a \\r\\n separator", () => {
    expect(getLocationAtIndex("ab\r\ncd", 5)).toEqual({ line: 2, column: 2 });
  });

  it("treats the index of the \\r in \\r\\n as the end of its line", () => {
    expect(getLocationAtIndex("ab\r\ncd", 2)).toEqual({ line: 1, column: 3 });
  });

  it("counts the \\r as a column when the index sits on the \\n of \\r\\n", () => {
    expect(getLocationAtIndex("ab\r\ncd", 3)).toEqual({ line: 1, column: 4 });
  });

  it("starts a new line right after a \\r\\n separator", () => {
    expect(getLocationAtIndex("ab\r\ncd", 4)).toEqual({ line: 2, column: 1 });
  });

  it("locates an index after a lone \\r separator", () => {
    expect(getLocationAtIndex("ab\rcd", 4)).toEqual({ line: 2, column: 2 });
  });

  it.each(["\u2028", "\u2029"])(
    "locates an index after an ECMAScript Unicode line separator",
    (separator) => {
      expect(getLocationAtIndex(`ab${separator}cd`, 4)).toEqual({ line: 2, column: 2 });
    },
  );

  it.each(["\u2028", "\u2029"])(
    "treats the index of an ECMAScript Unicode line separator as the end of its line",
    (separator) => {
      expect(getLocationAtIndex(`ab${separator}cd`, 2)).toEqual({ line: 1, column: 3 });
    },
  );

  it.each(["\u2028", "\u2029"])(
    "starts a line immediately after an ECMAScript Unicode line separator",
    (separator) => {
      expect(getLocationAtIndex(`ab${separator}cd`, 3)).toEqual({ line: 2, column: 1 });
    },
  );

  it("locates the end of content", () => {
    expect(getLocationAtIndex("ab\ncd", 5)).toEqual({ line: 2, column: 3 });
  });

  it("locates the end of content after a trailing \\n", () => {
    expect(getLocationAtIndex("ab\n", 3)).toEqual({ line: 2, column: 1 });
  });

  it("clamps a past-end index to the end of content", () => {
    expect(getLocationAtIndex("ab\ncd", 50)).toEqual({ line: 2, column: 3 });
    expect(getLocationAtIndex("hello world", 50)).toEqual({ line: 1, column: 12 });
  });

  it("handles empty content", () => {
    expect(getLocationAtIndex("", 0)).toEqual({ line: 1, column: 1 });
    expect(getLocationAtIndex("", 5)).toEqual({ line: 1, column: 1 });
  });

  it("handles consecutive newlines", () => {
    expect(getLocationAtIndex("a\n\nb", 2)).toEqual({ line: 2, column: 1 });
    expect(getLocationAtIndex("a\n\nb", 3)).toEqual({ line: 3, column: 1 });
  });

  it("handles mixed \\r\\n and \\n separators in one content", () => {
    expect(getLocationAtIndex("a\r\nb\nc\r\nd", 8)).toEqual({ line: 4, column: 1 });
  });

  it("stays correct when queries alternate between contents", () => {
    const firstContent = "ab\ncd\nef";
    const secondContent = "one\r\ntwo\r\nthree";
    expect(getLocationAtIndex(firstContent, 7)).toEqual({ line: 3, column: 2 });
    expect(getLocationAtIndex(secondContent, 6)).toEqual({ line: 2, column: 2 });
    expect(getLocationAtIndex(firstContent, 7)).toEqual({ line: 3, column: 2 });
    expect(getLocationAtIndex(secondContent, 12)).toEqual({ line: 3, column: 3 });
  });

  it("matches the reference implementation on seeded pseudo-random contents", () => {
    let seedState = 0x2f6e2b1;
    const nextRandom = (): number => {
      seedState = (seedState * 48271) % 0x7fffffff;
      return seedState / 0x7fffffff;
    };
    const alphabet = ["a", "b", " ", "\n", "\r", "\r\n", "\u2028", "\u2029", "\t", "é", "x\ny"];
    for (let contentRound = 0; contentRound < 60; contentRound += 1) {
      const pieceCount = Math.floor(nextRandom() * 40);
      let content = "";
      for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
        content += alphabet[Math.floor(nextRandom() * alphabet.length)];
      }
      for (let queryRound = 0; queryRound < 25; queryRound += 1) {
        const matchIndex = Math.floor(nextRandom() * (content.length + 3)) - 1;
        expect(getLocationAtIndex(content, matchIndex)).toEqual(
          referenceLocationAtIndex(content, matchIndex),
        );
      }
    }
  });
});
