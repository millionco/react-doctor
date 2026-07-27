import type { ChangedFileLineRanges } from "@react-doctor/core";
import { describe, expect, it } from "vite-plus/test";
import { resolveInspectOptions } from "../src/cli/utils/resolve-inspect-options.js";

describe("resolveInspectOptions", () => {
  it("preserves the complete default option contract", () => {
    expect(
      resolveInspectOptions({
        inputOptions: {},
        userConfig: null,
        environment: {
          isCiOrCodingAgentEnvironment: true,
          isNonInteractiveEnvironment: false,
        },
      }),
    ).toEqual({
      lint: true,
      deadCode: true,
      supplyChain: true,
      verbose: false,
      outputDirectory: null,
      scoreOnly: false,
      noScore: false,
      isCi: false,
      isCiOrCodingAgentEnvironment: true,
      isNonInteractiveEnvironment: false,
      silent: false,
      includePaths: [],
      customRulesOnly: false,
      share: true,
      respectInlineDisables: true,
      warnings: true,
      categoryFilters: new Set(),
      adoptExistingLintConfig: true,
      ignoredTags: new Set(),
      includedTags: new Set(),
      includeTagDefaults: false,
      scoreDisabledMessage: undefined,
      outputSurface: "cli",
      suppressRendering: false,
      uiLayers: null,
      concurrentScan: false,
      concurrency: undefined,
      maxDurationMs: null,
      baseline: null,
      changedLineRanges: null,
      supplyChainManifestChanged: false,
    });
  });

  it("preserves input precedence and included-tag activation policy", () => {
    const includedTags = new Set(["design"]);
    const includePaths = ["src/app.tsx"];
    const baseline = { ref: "origin/main" };
    const changedLineRanges: ReadonlyArray<ChangedFileLineRanges> = [
      { file: "src/app.tsx", ranges: [[2, 4]] },
    ];

    const resolvedOptions = resolveInspectOptions({
      inputOptions: {
        lint: true,
        warnings: true,
        noScore: false,
        respectInlineDisables: true,
        outputDirectory: "",
        includePaths,
        includedTags,
        includeTagDefaults: true,
        categoryFilters: ["performance"],
        outputSurface: "json",
        suppressRendering: true,
        concurrentScan: true,
        concurrency: 3,
        maxDurationMs: 2_000,
        baseline,
        changedLineRanges,
        supplyChainManifestChanged: true,
        scoreDisabledMessage: "Scoring disabled.",
      },
      userConfig: {
        lint: false,
        deadCode: false,
        supplyChain: { enabled: false },
        verbose: true,
        noScore: true,
        customRulesOnly: true,
        share: false,
        respectInlineDisables: false,
        warnings: false,
        adoptExistingLintConfig: false,
        ignore: { tags: ["design", "security"] },
      },
      environment: {
        isCiOrCodingAgentEnvironment: false,
        isNonInteractiveEnvironment: true,
      },
    });

    expect(resolvedOptions).toMatchObject({
      lint: true,
      deadCode: false,
      supplyChain: false,
      verbose: true,
      outputDirectory: null,
      noScore: false,
      customRulesOnly: false,
      share: false,
      respectInlineDisables: true,
      warnings: true,
      categoryFilters: new Set(["Performance"]),
      adoptExistingLintConfig: false,
      ignoredTags: new Set(["security"]),
      includedTags,
      includeTagDefaults: true,
      scoreDisabledMessage: "Scoring disabled.",
      outputSurface: "json",
      suppressRendering: true,
      concurrentScan: true,
      concurrency: 3,
      maxDurationMs: 2_000,
      baseline,
      changedLineRanges,
      supplyChainManifestChanged: true,
      isCiOrCodingAgentEnvironment: false,
      isNonInteractiveEnvironment: true,
    });
    expect(resolvedOptions.includePaths).toBe(includePaths);
    expect(resolvedOptions.baseline).toBe(baseline);
    expect(resolvedOptions.changedLineRanges).toBe(changedLineRanges);
  });
});
