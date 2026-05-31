import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { MINIFIED_MAX_LINE_LENGTH_CHARS } from "../src/constants.js";
import { isMinifiedSource } from "../src/utils/is-minified-source.js";

describe("isMinifiedSource", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "minified-source-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFile = (name: string, contents: string): string => {
    const filePath = path.join(temporaryDirectory, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  it("flags a one-line minified bundle", () => {
    const giantLine = `var x=${"a".repeat(MINIFIED_MAX_LINE_LENGTH_CHARS + 50)};`;
    expect(isMinifiedSource(writeFile("inject.js", giantLine))).toBe(true);
  });

  it("flags a file whose content is dominated by long lines", () => {
    const contents = Array.from({ length: 5 }, () =>
      "a".repeat(MINIFIED_MAX_LINE_LENGTH_CHARS + 1),
    ).join("\n");
    expect(isMinifiedSource(writeFile("bundle.js", contents))).toBe(true);
  });

  it("does NOT flag a real source file with one long line among short ones", () => {
    // e.g. an inline SVG `<path d="…">`, a base64 data URI, or a one-line
    // generated GraphQL document embedded in otherwise normal source.
    const longLine = `const icon = "${"M0 0".repeat(MINIFIED_MAX_LINE_LENGTH_CHARS / 4 + 10)}";`;
    const contents = [
      ...Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`),
      longLine,
      ...Array.from({ length: 200 }, (_, index) => `const more${index} = ${index};`),
    ].join("\n");
    expect(isMinifiedSource(writeFile("Icon.tsx", contents))).toBe(false);
  });

  it("does NOT flag a dense data file of long rows with a single very long row", () => {
    // e.g. an i18n catalog or a generated route/data table: every line is a
    // few hundred chars (so the average clears the old 200 floor) and one row
    // tops 1000 chars — but the average stays well under genuine minified
    // output, which packs everything into the thousands.
    const denseRows = Array.from(
      { length: 200 },
      (_, index) => `  "translation.key.${index}": "${"word ".repeat(40)}",`,
    );
    const oneVeryLongRow = `  "translation.long": "${"word ".repeat(220)}",`;
    const contents = [...denseRows, oneVeryLongRow].join("\n");
    expect(isMinifiedSource(writeFile("messages.ts", contents))).toBe(false);
  });

  it("accepts ordinary multi-line source", () => {
    const contents = Array.from(
      { length: 200 },
      (_, index) => `const value${index} = ${index};`,
    ).join("\n");
    expect(isMinifiedSource(writeFile("App.tsx", contents))).toBe(false);
  });

  it("returns false for an unreadable path", () => {
    expect(isMinifiedSource(path.join(temporaryDirectory, "does-not-exist.js"))).toBe(false);
  });
});
