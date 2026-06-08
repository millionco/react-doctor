import { describe, expect, it } from "vite-plus/test";
import { isLintableSourceFile } from "../src/utils/is-lintable-source-file.js";

describe("isLintableSourceFile", () => {
  it("accepts ordinary JS/TS source files", () => {
    for (const filePath of [
      "src/App.tsx",
      "src/index.ts",
      "src/edge.mts",
      "components/Button.jsx",
      "lib/util.js",
      "middleware.mjs",
      "deep/nested/path/Widget.tsx",
    ]) {
      expect(isLintableSourceFile(filePath), filePath).toBe(true);
    }
  });

  it("rejects non-source files", () => {
    for (const filePath of [
      "styles.css",
      "README.md",
      "data.json",
      "logo.svg",
      "scripts/build.cjs",
    ]) {
      expect(isLintableSourceFile(filePath), filePath).toBe(false);
    }
  });

  it("rejects generated IIFE / UMD / global / minified `.js` / `.mjs` bundles", () => {
    for (const filePath of [
      "public/budge.iife.js",
      "public/sdk.global.js",
      "public/sdk.umd.js",
      "public/vendor.min.js",
      "public/chunk.min.mjs",
      "public/embed.global.mjs",
      "nested/dir/embed.IIFE.js",
    ]) {
      expect(isLintableSourceFile(filePath), filePath).toBe(false);
    }
  });

  it("does not over-match files that merely contain a bundle keyword in the name", () => {
    for (const filePath of [
      "src/iife-helpers.ts",
      "src/global-state.ts",
      "src/useGlobalStore.tsx",
      "src/admin.js",
      "src/medium-editor.tsx",
      "src/format.minified.js",
    ]) {
      expect(isLintableSourceFile(filePath), filePath).toBe(true);
    }
  });
});
