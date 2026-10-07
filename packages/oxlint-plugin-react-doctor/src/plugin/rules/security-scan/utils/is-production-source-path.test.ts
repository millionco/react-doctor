import { describe, expect, it } from "vite-plus/test";
import { isProductionSourcePath } from "./is-production-source-path.js";

describe("isProductionSourcePath", () => {
  it("excludes root test-prefixed source files", () => {
    expect(isProductionSourcePath("test-katex-error.tsx")).toBe(false);
    expect(isProductionSourcePath("spec-parser.ts")).toBe(false);
  });

  it("keeps nested test-prefixed production source files", () => {
    expect(isProductionSourcePath("src/test-user-content.tsx")).toBe(true);
    expect(isProductionSourcePath("components/spec-preview.jsx")).toBe(true);
  });

  it("keeps production files whose names merely contain test", () => {
    expect(isProductionSourcePath("src/components/testimonials.tsx")).toBe(true);
    expect(isProductionSourcePath("src/latest-release.ts")).toBe(true);
  });
});
