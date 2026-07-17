import { describe, expect, it } from "vite-plus/test";
import { isNonSourceFilename } from "./is-non-source-filename.js";

describe("isNonSourceFilename", () => {
  it("recognizes generated directories in absolute and relative paths", () => {
    expect(isNonSourceFilename("/repo/dist/index.js")).toBe(true);
    expect(isNonSourceFilename("build/index.js")).toBe(true);
  });

  it("normalizes Windows path separators", () => {
    expect(isNonSourceFilename("C:\\repo\\public\\vendor.js")).toBe(true);
  });

  it("keeps similarly named source directories", () => {
    expect(isNonSourceFilename("/repo/src/distribution/index.ts")).toBe(false);
  });
});
