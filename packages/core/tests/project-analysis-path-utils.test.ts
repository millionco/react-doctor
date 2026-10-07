import { describe, expect, it } from "vite-plus/test";
import { buildExportKey } from "../src/project-analysis/utils/build-export-key.js";
import { isPathInsideDirectoryOrEqual } from "../src/project-analysis/utils/is-path-inside-directory-or-equal.js";

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
});
