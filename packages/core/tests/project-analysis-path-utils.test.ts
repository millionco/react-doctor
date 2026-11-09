import { describe, expect, it } from "vite-plus/test";
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

  it("keeps children whose first path segment starts with two dots", () => {
    expect(isPathInsideDirectory("/tmp/project/..cache/file.ts", "/tmp/project")).toBe(true);
    expect(isPathInsideDirectory("/tmp/project-copy/file.ts", "/tmp/project")).toBe(false);
    expect(isPathInsideDirectory("/tmp/project", "/tmp/project")).toBe(false);
  });
});
