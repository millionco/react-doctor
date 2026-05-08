import { describe, expect, it } from "vite-plus/test";
import { parseFileLineArgument } from "../src/utils/parse-file-line-argument.js";

describe("parseFileLineArgument", () => {
  it("parses `path:line` into its parts", () => {
    expect(parseFileLineArgument("src/foo.tsx:42")).toEqual({
      filePath: "src/foo.tsx",
      line: 42,
    });
  });

  it("uses the LAST colon so paths with colons (Windows drive letters) round-trip", () => {
    expect(parseFileLineArgument("C:/repo/src/foo.tsx:7")).toEqual({
      filePath: "C:/repo/src/foo.tsx",
      line: 7,
    });
  });

  it("rejects arguments with no colon", () => {
    expect(() => parseFileLineArgument("src/foo.tsx")).toThrowError(/<file>:<line>/);
  });

  it("rejects empty file paths", () => {
    expect(() => parseFileLineArgument(":42")).toThrowError(/Missing file path/);
  });

  it("rejects non-positive line numbers", () => {
    expect(() => parseFileLineArgument("src/foo.tsx:0")).toThrowError(/positive line number/);
    expect(() => parseFileLineArgument("src/foo.tsx:-1")).toThrowError(/positive line number/);
  });

  it("rejects non-numeric line tokens", () => {
    expect(() => parseFileLineArgument("src/foo.tsx:abc")).toThrowError(/positive line number/);
    expect(() => parseFileLineArgument("src/foo.tsx:42abc")).toThrowError(/positive line number/);
  });
});
