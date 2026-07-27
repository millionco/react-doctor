import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo, ScoreResult } from "@react-doctor/core";
import { buildInspectResult } from "../src/cli/utils/build-inspect-result.js";
import type { BuildInspectResultInput } from "../src/cli/utils/build-inspect-result.js";

const diagnostic: Diagnostic = {
  filePath: "/repo/src/app.tsx",
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
  help: "Fix the example",
  line: 1,
  column: 1,
  category: "Correctness",
};

const score: ScoreResult = {
  score: 92,
  label: "Excellent",
};

const project: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "example",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  sourceFileCount: 1,
};

const baseInput = (overrides: Partial<BuildInspectResultInput> = {}): BuildInspectResultInput => ({
  diagnostics: [diagnostic],
  score,
  skippedChecks: [],
  skippedCheckReasons: {},
  project,
  elapsedMilliseconds: 120,
  scannedFileCount: 1,
  scannedFilePaths: ["/repo/src/app.tsx"],
  analyzedFiles: ["src/app.tsx"],
  scanElapsedMilliseconds: 100,
  lintCacheHitFileCount: null,
  lintCacheTotalFileCount: null,
  lintSidecarReplayedFileCount: null,
  lintSidecarTotalFileCount: null,
  deadCodeCacheHit: null,
  deadCodeSummaryCacheHits: null,
  deadCodeSummaryCacheMisses: null,
  baselineDelta: undefined,
  ...overrides,
});

describe("buildInspectResult", () => {
  it("builds the stable required result shape and omits absent optional fields", () => {
    const input = baseInput();
    const result = buildInspectResult(input);

    expect(result).toEqual({
      diagnostics: [diagnostic],
      score,
      skippedChecks: [],
      project,
      elapsedMilliseconds: 120,
      scannedFileCount: 1,
      scannedFilePaths: ["/repo/src/app.tsx"],
      analyzedFiles: ["src/app.tsx"],
      scanElapsedMilliseconds: 100,
    });
    expect(result.diagnostics).not.toBe(input.diagnostics);
    expect(result.project).toBe(project);
    expect(result.score).toBe(score);
    expect(result.scannedFilePaths).toBe(input.scannedFilePaths);
    expect(result.analyzedFiles).toBe(input.analyzedFiles);
  });

  it("includes every complete optional result group without changing values", () => {
    expect(
      buildInspectResult(
        baseInput({
          skippedChecks: ["lint"],
          skippedCheckReasons: { lint: "Oxlint failed." },
          lintCacheHitFileCount: 0,
          lintCacheTotalFileCount: 4,
          lintSidecarReplayedFileCount: 1,
          lintSidecarTotalFileCount: 2,
          deadCodeCacheHit: false,
          deadCodeSummaryCacheHits: 3,
          deadCodeSummaryCacheMisses: 5,
          baselineDelta: {
            baseRef: "base",
            fixedCount: 2,
            baseTotalCount: 9,
            crossFileMatchCount: 1,
          },
        }),
      ),
    ).toEqual({
      diagnostics: [diagnostic],
      score,
      skippedChecks: ["lint"],
      skippedCheckReasons: { lint: "Oxlint failed." },
      project,
      elapsedMilliseconds: 120,
      scannedFileCount: 1,
      scannedFilePaths: ["/repo/src/app.tsx"],
      analyzedFiles: ["src/app.tsx"],
      scanElapsedMilliseconds: 100,
      lintCacheHitFileCount: 0,
      lintCacheTotalFileCount: 4,
      lintSidecarReplayedFileCount: 1,
      lintSidecarTotalFileCount: 2,
      deadCodeCacheHit: false,
      deadCodeSummaryCacheHits: 3,
      deadCodeSummaryCacheMisses: 5,
      baselineDelta: {
        baseRef: "base",
        fixedCount: 2,
        baseTotalCount: 9,
        crossFileMatchCount: 1,
      },
    });
  });

  it("omits incomplete cache-stat groups exactly", () => {
    const result = buildInspectResult(
      baseInput({
        lintCacheHitFileCount: 3,
        lintCacheTotalFileCount: null,
        lintSidecarReplayedFileCount: 2,
        lintSidecarTotalFileCount: null,
        deadCodeSummaryCacheHits: 4,
        deadCodeSummaryCacheMisses: null,
      }),
    );

    expect(result).not.toHaveProperty("lintCacheHitFileCount");
    expect(result).not.toHaveProperty("lintCacheTotalFileCount");
    expect(result).not.toHaveProperty("lintSidecarReplayedFileCount");
    expect(result).not.toHaveProperty("lintSidecarTotalFileCount");
    expect(result).not.toHaveProperty("deadCodeSummaryCacheHits");
    expect(result).not.toHaveProperty("deadCodeSummaryCacheMisses");
  });
});
