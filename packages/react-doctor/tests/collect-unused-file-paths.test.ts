import { describe, expect, it } from "vite-plus/test";
import { collectUnusedFilePaths } from "../src/utils/collect-unused-file-paths.js";

describe("collectUnusedFilePaths", () => {
  it("extracts file paths from a knip 6.x IssueRecords object", () => {
    const knipFilesIssues = {
      "src/unused-a.ts": {
        "src/unused-a.ts": {
          type: "files",
          filePath: "/repo/src/unused-a.ts",
          symbol: "src/unused-a.ts",
          workspace: "",
          severity: "warn",
          fixes: [],
        },
      },
      "src/unused-b.ts": {
        "src/unused-b.ts": {
          type: "files",
          filePath: "/repo/src/unused-b.ts",
          symbol: "src/unused-b.ts",
          workspace: "",
          severity: "warn",
          fixes: [],
        },
      },
    };

    expect(collectUnusedFilePaths(knipFilesIssues)).toEqual([
      "/repo/src/unused-a.ts",
      "/repo/src/unused-b.ts",
    ]);
  });

  it("handles legacy Set<string> output", () => {
    const filesSet = new Set(["/repo/src/a.ts", "/repo/src/b.ts"]);
    expect(collectUnusedFilePaths(filesSet)).toEqual(["/repo/src/a.ts", "/repo/src/b.ts"]);
  });

  it("handles array output", () => {
    expect(collectUnusedFilePaths(["/repo/src/a.ts", "/repo/src/b.ts"])).toEqual([
      "/repo/src/a.ts",
      "/repo/src/b.ts",
    ]);
  });

  it("returns an empty array when input is undefined", () => {
    expect(collectUnusedFilePaths(undefined)).toEqual([]);
  });

  it("returns an empty array when input is an empty object", () => {
    expect(collectUnusedFilePaths({})).toEqual([]);
  });

  it("skips entries without a string filePath", () => {
    const malformed = {
      "src/a.ts": {
        "src/a.ts": { type: "files", symbol: "src/a.ts" },
      },
    };
    expect(collectUnusedFilePaths(malformed)).toEqual([]);
  });
});
