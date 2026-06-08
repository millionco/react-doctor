import { describe, expect, it } from "vite-plus/test";
import { computeExplicitLintIncludePaths } from "@react-doctor/core";

describe("computeExplicitLintIncludePaths", () => {
  it("returns undefined for empty include paths", () => {
    expect(computeExplicitLintIncludePaths([])).toBeUndefined();
  });

  it("filters to ordinary component-bearing JSX/TSX files", () => {
    const paths = ["src/app.tsx", "src/utils.ts", "src/Button.jsx", "src/config.js"];
    const result = computeExplicitLintIncludePaths(paths);
    expect(result).toEqual(["src/app.tsx", "src/Button.jsx"]);
  });

  it("keeps Next middleware and proxy entry files in Next projects", () => {
    const paths = [
      "middleware.ts",
      "middleware.mjs",
      "src/proxy.ts",
      "src/proxy.mts",
      "src/app.tsx",
      "src/server.ts",
      "nested/middleware.ts",
    ];

    const result = computeExplicitLintIncludePaths(paths, {
      rootDirectory: "/repo",
      projectName: "next-app",
      reactVersion: "19.0.0",
      reactMajorVersion: 19,
      tailwindVersion: null,
      zodVersion: null,
      zodMajorVersion: null,
      framework: "nextjs",
      hasTypeScript: true,
      hasReactCompiler: false,
      hasTanStackQuery: false,
      nextjsVersion: "^16.0.0",
      nextjsMajorVersion: 16,
      hasReactNativeWorkspace: false,
      expoVersion: null,
      shopifyFlashListVersion: null,
      shopifyFlashListMajorVersion: null,
      hasReanimated: false,
      preactVersion: null,
      preactMajorVersion: null,
      sourceFileCount: 0,
    });

    expect(result).toEqual([
      "middleware.ts",
      "middleware.mjs",
      "src/proxy.ts",
      "src/proxy.mts",
      "src/app.tsx",
    ]);
  });

  it("does not keep Next entry filenames for non-Next projects", () => {
    const paths = ["middleware.ts", "src/proxy.mjs", "src/App.tsx"];
    const result = computeExplicitLintIncludePaths(paths, {
      rootDirectory: "/repo",
      projectName: "vite-app",
      reactVersion: "19.0.0",
      reactMajorVersion: 19,
      tailwindVersion: null,
      zodVersion: null,
      zodMajorVersion: null,
      framework: "vite",
      hasTypeScript: true,
      hasReactCompiler: false,
      hasTanStackQuery: false,
      nextjsVersion: null,
      nextjsMajorVersion: null,
      hasReactNativeWorkspace: false,
      expoVersion: null,
      shopifyFlashListVersion: null,
      shopifyFlashListMajorVersion: null,
      hasReanimated: false,
      preactVersion: null,
      preactMajorVersion: null,
      sourceFileCount: 0,
    });

    expect(result).toEqual(["src/App.tsx"]);
  });

  it("returns empty array when no explicitly lintable files exist", () => {
    const paths = ["src/utils.ts", "src/config.js"];
    const result = computeExplicitLintIncludePaths(paths);
    expect(result).toEqual([]);
  });
});
