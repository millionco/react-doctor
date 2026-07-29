import { describe, expect, it } from "vite-plus/test";
import { resolveInspectScanSettings } from "../src/resolve-inspect-scan-settings.js";
import type { InspectInput } from "../src/run-inspect.js";

const buildInput = (overrides: Partial<InspectInput> = {}): InspectInput => ({
  directory: "/project",
  includePaths: [],
  customRulesOnly: false,
  respectInlineDisables: true,
  adoptExistingLintConfig: false,
  ignoredTags: new Set(),
  runDeadCode: true,
  isCi: false,
  ...overrides,
});

describe("resolveInspectScanSettings", () => {
  it("returns the exact full-scan defaults", () => {
    expect(
      resolveInspectScanSettings({
        input: buildInput(),
        rootDirectory: "/project",
        userConfig: null,
      }),
    ).toEqual({
      lintIncludePaths: undefined,
      isDiffMode: false,
      showWarnings: true,
      shouldCollectFallbackScannedFilePaths: false,
      shouldRunSupplyChain: true,
    });
  });

  it("filters explicit paths and disables whole-project checks in diff mode", () => {
    expect(
      resolveInspectScanSettings({
        input: buildInput({
          includePaths: ["src/app.tsx", "README.md"],
        }),
        rootDirectory: "/project",
        userConfig: { warnings: false },
      }),
    ).toEqual({
      lintIncludePaths: ["src/app.tsx"],
      isDiffMode: true,
      showWarnings: false,
      shouldCollectFallbackScannedFilePaths: false,
      shouldRunSupplyChain: false,
    });
  });

  it("preserves exact editor paths through a fresh array", () => {
    const includePaths = ["src/app.tsx", "README.md"];
    const settings = resolveInspectScanSettings({
      input: buildInput({
        includePaths,
        skipExplicitIncludePathFilter: true,
      }),
      rootDirectory: "/project",
      userConfig: null,
    });

    expect(settings.lintIncludePaths).toEqual(includePaths);
    expect(settings.lintIncludePaths).not.toBe(includePaths);
  });

  it("preserves input precedence and diff manifest supply-chain behavior", () => {
    expect(
      resolveInspectScanSettings({
        input: buildInput({
          includePaths: ["src/app.tsx"],
          warnings: true,
          suppressScanSummary: true,
          supplyChainManifestChanged: true,
        }),
        rootDirectory: "/project",
        userConfig: { warnings: false },
      }),
    ).toMatchObject({
      showWarnings: true,
      shouldCollectFallbackScannedFilePaths: true,
      shouldRunSupplyChain: true,
    });
  });

  it("keeps empty editor selections on the full-scan fallback path", () => {
    expect(
      resolveInspectScanSettings({
        input: buildInput({
          skipExplicitIncludePathFilter: true,
        }),
        rootDirectory: "/project",
        userConfig: null,
      }).lintIncludePaths,
    ).toBeUndefined();
  });
});
