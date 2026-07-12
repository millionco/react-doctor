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

// Defaults `tsconfigContent` to null so each test names only the input it varies.
const hash = (
  input: Partial<Parameters<typeof computeRulesetHash>[0]> & {
    config: ReturnType<typeof createOxlintConfig>;
  },
): string =>
  computeRulesetHash({
    toolchainVersions: TOOLCHAIN,
    ignorePatterns: [],
    tsconfigContent: null,
    respectInlineDisables: true,
    ...input,
  });

describe("computeRulesetHash", () => {
  it("is deterministic for identical inputs", () => {
    const project = makeProject("/repo/a");
    const first = hash({ config: cacheableConfig(project), ignorePatterns: ["dist/"] });
    const second = hash({ config: cacheableConfig(project), ignorePatterns: ["dist/"] });
    expect(first).toBe(second);
  });

  it("ignores the absolute rootDirectory so the hash is portable across checkouts", () => {
    const hashAtPathA = hash({ config: cacheableConfig(makeProject("/runner/work/repo/repo")) });
    const hashAtPathB = hash({ config: cacheableConfig(makeProject("/Users/dev/projects/repo")) });
    expect(hashAtPathA).toBe(hashAtPathB);
  });

  it("changes when a rule's severity changes", () => {
    const project = makeProject("/repo/a");
    const baseline = hash({ config: cacheableConfig(project) });
    // Enable a default-disabled rule — a different enabled rule set than the
    // baseline, so the resolved `rules` map (and thus the hash) changes.
    const withOverride = hash({
      config: cacheableConfig(project, { rules: { "react-doctor/no-array-index-key": "error" } }),
    });
    expect(withOverride).not.toBe(baseline);
  });

  it("changes when the toolchain version changes", () => {
    const config = cacheableConfig(makeProject("/repo/a"));
    const onOldOxlint = hash({
      config,
      toolchainVersions: ["node=v22.0.0", "oxlint/package.json=1.0.0"],
    });
    const onNewOxlint = hash({
      config,
      toolchainVersions: ["node=v22.0.0", "oxlint/package.json=1.1.0"],
    });
    expect(onNewOxlint).not.toBe(onOldOxlint);
  });

  it("changes when ignore patterns change (they decide which files emit diagnostics)", () => {
    const config = cacheableConfig(makeProject("/repo/a"));
    const withoutIgnore = hash({ config });
    const withIgnore = hash({ config, ignorePatterns: ["src/generated/**"] });
    expect(withIgnore).not.toBe(withoutIgnore);
  });

  it("partitions audit mode from default mode (neutralize changes the raw stream)", () => {
    const config = cacheableConfig(makeProject("/repo/a"));
    const defaultMode = hash({ config, respectInlineDisables: true });
    const auditMode = hash({ config, respectInlineDisables: false });
    expect(auditMode).not.toBe(defaultMode);
  });

  it("changes when tsconfig content changes (oxlint parses with it)", () => {
    const config = cacheableConfig(makeProject("/repo/a"));
    const withBaseTsconfig = hash({
      config,
      tsconfigContent: JSON.stringify({ compilerOptions: { jsx: "preserve", strict: false } }),
    });
    const withChangedTsconfig = hash({
      config,
      tsconfigContent: JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true } }),
    });
    expect(withChangedTsconfig).not.toBe(withBaseTsconfig);
    // A non-TS project (null) is stable and distinct from any concrete tsconfig.
    expect(hash({ config })).not.toBe(withBaseTsconfig);
  });
});
