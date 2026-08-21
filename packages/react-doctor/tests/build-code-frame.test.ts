import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CODE_FRAME_MAX_LINE_LENGTH_CHARS } from "@react-doctor/core";
import { buildCodeFrame } from "../src/cli/utils/build-code-frame.js";

describe("buildCodeFrame", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "build-code-frame-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFile = (name: string, contents: string): string => {
    const filePath = path.join(temporaryDirectory, name);
    fs.writeFileSync(filePath, contents);
    return name;
  };

  it("renders a frame for an ordinary short line", () => {
    const filePath = writeFile("App.tsx", "const value = 1;\nconst other = eval(value);\n");
    const frame = buildCodeFrame({
      filePath,
      line: 2,
      column: 15,
      rootDirectory: temporaryDirectory,
    });
    expect(frame).not.toBeNull();
    const plainFrame = stripVTControlCharacters(frame ?? "");
    expect(plainFrame).toContain("eval(value)");
    expect(plainFrame).toContain("    |               ^");
  });

  it("renders a labeled multi-line range with bounded context", () => {
    const filePath = writeFile(
      "range.tsx",
      ["const before = 1;", "const first = 2;", "const second = 3;", "const after = 4;"].join("\n"),
    );
    const frame = buildCodeFrame({
      filePath,
      line: 2,
      column: 1,
      endLine: 3,
      message: "Repeated issue",
      rootDirectory: temporaryDirectory,
    });
    expect(frame).not.toBeNull();
    expect(stripVTControlCharacters(frame ?? "")).toBe(
      [
        "   Repeated issue",
        "  1 | const before = 1;",
        "> 2 | const first = 2;",
        "> 3 | const second = 3;",
        "  4 | const after = 4;",
      ].join("\n"),
    );
  });

  it("returns null when the location is past the end of the file", () => {
    const filePath = writeFile("short.tsx", "const value = 1;\n");
    expect(
      buildCodeFrame({ filePath, line: 5, column: 1, rootDirectory: temporaryDirectory }),
    ).toBeNull();
  });

  it("returns null when the offending line is too long to render usefully", () => {
    const longLine = `const note = "${"x".repeat(CODE_FRAME_MAX_LINE_LENGTH_CHARS + 1)}";`;
    const filePath = writeFile("long.tsx", `${longLine}\nconst ok = 1;\n`);
    expect(
      buildCodeFrame({ filePath, line: 1, column: 1, rootDirectory: temporaryDirectory }),
    ).toBeNull();
  });

  it("returns null for a non-positive line number", () => {
    const filePath = writeFile("zero.tsx", "const value = 1;\n");
    expect(
      buildCodeFrame({ filePath, line: 0, column: 1, rootDirectory: temporaryDirectory }),
    ).toBeNull();
  });

  it("returns null when the file can't be read", () => {
    expect(
      buildCodeFrame({
        filePath: "does-not-exist.tsx",
        line: 1,
        column: 1,
        rootDirectory: temporaryDirectory,
      }),
    ).toBeNull();
  });
});
