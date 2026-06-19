import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "../src/types/index.js";
import { computeRulesetHash } from "../src/runners/oxlint/compute-ruleset-hash.js";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";

const makeProject = (rootDirectory: string): ProjectInfo => ({
  rootDirectory,
  projectName: "fixture",
  reactVersion: "^19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: "^15.0.0",
  nextjsMajorVersion: 15,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 0,
});

const PLUGIN_PATH = "/abs/node_modules/oxlint-plugin-react-doctor/dist/index.js";

const cacheableConfig = (
  project: ProjectInfo,
  severityControls?: Parameters<typeof createOxlintConfig>[0]["severityControls"],
) =>
  createOxlintConfig({
    pluginPath: PLUGIN_PATH,
    project,
    ruleSelection: "cacheable",
    severityControls,
  });

const TOOLCHAIN = ["node=v22.0.0", "oxlint/package.json=1.0.0"];

describe("computeRulesetHash", () => {
  it("is deterministic for identical inputs", () => {
    const project = makeProject("/repo/a");
    const first = computeRulesetHash({
      config: cacheableConfig(project),
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: ["dist/"],
    });
    const second = computeRulesetHash({
      config: cacheableConfig(project),
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: ["dist/"],
    });
    expect(first).toBe(second);
  });

  it("ignores the absolute rootDirectory so the hash is portable across checkouts", () => {
    const hashAtPathA = computeRulesetHash({
      config: cacheableConfig(makeProject("/runner/work/repo/repo")),
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: [],
    });
    const hashAtPathB = computeRulesetHash({
      config: cacheableConfig(makeProject("/Users/dev/projects/repo")),
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: [],
    });
    expect(hashAtPathA).toBe(hashAtPathB);
  });

  it("changes when a rule's severity changes", () => {
    const project = makeProject("/repo/a");
    const baseline = computeRulesetHash({
      config: cacheableConfig(project),
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: [],
    });
    const withOverride = computeRulesetHash({
      // Enable a default-disabled rule — a different enabled rule set than the
      // baseline, so the resolved `rules` map (and thus the hash) changes.
      config: cacheableConfig(project, { rules: { "react-doctor/no-array-index-key": "error" } }),
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: [],
    });
    expect(withOverride).not.toBe(baseline);
  });

  it("changes when the toolchain version changes", () => {
    const project = makeProject("/repo/a");
    const config = cacheableConfig(project);
    const onOldOxlint = computeRulesetHash({
      config,
      toolchainVersions: ["node=v22.0.0", "oxlint/package.json=1.0.0"],
      ignorePatterns: [],
    });
    const onNewOxlint = computeRulesetHash({
      config,
      toolchainVersions: ["node=v22.0.0", "oxlint/package.json=1.1.0"],
      ignorePatterns: [],
    });
    expect(onNewOxlint).not.toBe(onOldOxlint);
  });

  it("changes when ignore patterns change (they decide which files emit diagnostics)", () => {
    const project = makeProject("/repo/a");
    const config = cacheableConfig(project);
    const withoutIgnore = computeRulesetHash({
      config,
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: [],
    });
    const withIgnore = computeRulesetHash({
      config,
      toolchainVersions: TOOLCHAIN,
      ignorePatterns: ["src/generated/**"],
    });
    expect(withIgnore).not.toBe(withoutIgnore);
  });
});
