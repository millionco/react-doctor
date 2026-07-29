import { describe, expect, it } from "vite-plus/test";
import { buildScanResultCachePolicy } from "../src/cli/utils/scan-result-cache-policy.js";
import { resolveInspectOptions } from "../src/cli/utils/resolve-inspect-options.js";

describe("buildScanResultCachePolicy", () => {
  it("projects only cache-relevant fields with exact nullish behavior", () => {
    const resolvedOptions = resolveInspectOptions({
      inputOptions: {
        lint: false,
        deadCode: false,
        supplyChain: false,
        includePaths: ["src/app.tsx"],
        customRulesOnly: true,
        respectInlineDisables: false,
        warnings: false,
        adoptExistingLintConfig: false,
        includedTags: new Set(["design"]),
        includeTagDefaults: true,
        concurrency: 2,
        baseline: { ref: "" },
        changedLineRanges: [],
        noScore: true,
        isCi: true,
        suppressRendering: true,
        supplyChainManifestChanged: true,
      },
      userConfig: {
        ignore: { tags: ["security"] },
      },
      environment: {
        isCiOrCodingAgentEnvironment: false,
        isNonInteractiveEnvironment: false,
      },
    });

    expect(buildScanResultCachePolicy(resolvedOptions)).toEqual({
      lint: false,
      deadCode: false,
      supplyChain: false,
      includePaths: ["src/app.tsx"],
      customRulesOnly: false,
      respectInlineDisables: false,
      warnings: false,
      adoptExistingLintConfig: false,
      ignoredTags: new Set(["security"]),
      includedTags: new Set(["design"]),
      includeTagDefaults: true,
      concurrency: 2,
      baselineRef: "",
      changedLineRanges: [],
      noScore: true,
      isCi: true,
      suppressRendering: true,
      supplyChainManifestChanged: true,
    });
  });
});
