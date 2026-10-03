import { describe, expect, it } from "vite-plus/test";
import * as path from "node:path";
import { buildExportKey } from "../src/project-analysis/utils/build-export-key.js";
import { isPathInsideDirectoryOrEqual } from "../src/project-analysis/utils/is-path-inside-directory-or-equal.js";
import { isPathInsideDirectory } from "../src/utils/is-path-inside-directory.js";

describe("project-analysis path utilities", () => {
  it("normalizes export identity path separators", () => {
    expect(buildExportKey("C:\\project\\src\\page.tsx", "Page")).toBe(
      "C:/project/src/page.tsx::Page",
    );
  });

  it("compares directory containment across path separators", () => {
    expect(isPathInsideDirectoryOrEqual("C:/project/src/page.tsx", "C:\\project")).toBe(true);
    expect(isPathInsideDirectoryOrEqual("C:/project-copy/page.tsx", "C:\\project")).toBe(false);
  });

  it("accepts child directories whose names start with two dots", () => {
    const rootDirectory = path.resolve("/project");
    expect(isPathInsideDirectory(path.join(rootDirectory, "..cache/file.ts"), rootDirectory)).toBe(
      true,
    );
    expect(
      isPathInsideDirectory(path.join(`${rootDirectory}-copy`, "file.ts"), rootDirectory),
    ).toBe(false);
    expect(isPathInsideDirectory(rootDirectory, rootDirectory)).toBe(false);
  });
});
