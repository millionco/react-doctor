import { describe, expect, it } from "vite-plus/test";
import { computeExplicitLintIncludePaths } from "@react-doctor/core";

describe("computeExplicitLintIncludePaths", () => {
  it("returns undefined for empty include paths", () => {
    expect(computeExplicitLintIncludePaths([])).toBeUndefined();
  });

  it("keeps every supported JS and TS source extension", () => {
    const paths = [
      "src/app.tsx",
      "src/utils.ts",
      "src/Button.jsx",
      "src/config.js",
      "src/hooks.mts",
      "src/runtime.mjs",
      "src/legacy.cts",
      "src/legacy.cjs",
      "src/styles.css",
    ];
    const result = computeExplicitLintIncludePaths(paths);
    expect(result).toEqual([
      "src/app.tsx",
      "src/utils.ts",
      "src/Button.jsx",
      "src/config.js",
      "src/hooks.mts",
      "src/runtime.mjs",
    ]);
  });

  it("keeps ordinary modules and framework entry files in every project", () => {
    const paths = [
      "middleware.ts",
      "middleware.mjs",
      "src/proxy.ts",
      "src/proxy.mts",
      "src/app.tsx",
      "src/server.ts",
      "nested/middleware.ts",
    ];

    const result = computeExplicitLintIncludePaths(paths);

    expect(result).toEqual([
      "middleware.ts",
      "middleware.mjs",
      "src/proxy.ts",
      "src/proxy.mts",
      "src/app.tsx",
      "src/server.ts",
      "nested/middleware.ts",
    ]);
  });

  it("returns empty array when no explicitly lintable files exist", () => {
    const paths = ["src/styles.css", "src/data.json", "src/legacy.cjs"];
    const result = computeExplicitLintIncludePaths(paths);
    expect(result).toEqual([]);
  });
});
