/**
 * Regression tests for scan-pipeline robustness — the issues here all
 * stemmed from a runtime crash, silent failure, or "all results lost on
 * one bad input" failure mode.
 *
 * Covered closed issues:
 *   #29  — `extractFailedPluginName` must never throw on undefined / null
 *          / non-Error inputs (the "cannot read 'match' of undefined" crash)
 *   #46 + #84 — oxlint must batch include-paths so a 1k+-file diff
 *               (Windows ENAMETOOLONG) or 70+ test file batch (oxlint
 *               SIGABRT @ 2.8GB RAM) doesn't blow up
 *   #53  — source file count must fall back to filesystem walk when not
 *          inside a git repo
 *   #89  — `--offline` calculates the score locally (no network round trip)
 *   #115 — `--staged` snapshots git INDEX content (not working tree) so
 *          partially-staged hunks behave correctly
 *   #149 — empty / whitespace-only pattern strings reaching knip cause
 *          `picomatch` to throw `Expected pattern to be a non-empty
 *          string`, killing the whole dead-code step. The sanitizer
 *          strips them before `main()` runs.
 *   #141 — REACT_COMPILER_RULES must not be enabled in the oxlint config
 *          unless the `react-hooks-js` plugin actually resolved —
 *          otherwise oxlint errors with "Plugin 'react-hooks-js' not found".
 *          Additionally, when the plugin DOES resolve we must filter the
 *          rule list to only the names the loaded version actually
 *          exports — older plugin versions can lack newer compiler rules,
 *          so React Compiler users would otherwise hit
 *          "Rule 'void-use-memo' not found in plugin 'react-hooks-js'".
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { OXLINT_MAX_FILES_PER_BATCH, SPAWN_ARGS_MAX_LENGTH_CHARS } from "../../src/constants.js";
import { calculateScoreLocally } from "../../src/core/calculate-score-locally.js";
import { createOxlintConfig } from "../../src/core/runners/oxlint/config.js";
import { batchIncludePaths } from "../../src/core/batch-include-paths.js";
import { discoverProject } from "../../src/core/discover-project.js";
import { extractFailedPluginName } from "../../src/core/extract-failed-plugin-name.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../../src/cli/get-staged-files.js";
import { sanitizeKnipConfigPatterns } from "../../src/core/sanitize-knip-config-patterns.js";
import {
  buildDiagnostic,
  buildTestProject,
  initGitRepo,
  writeFile,
  writeJson,
} from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-scan-resilience-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("issue #29: extract-failed-plugin-name handles bad inputs safely", () => {
  it("never throws on undefined / null / non-Error inputs", () => {
    expect(extractFailedPluginName(undefined)).toBeNull();
    expect(extractFailedPluginName(null)).toBeNull();
    expect(extractFailedPluginName({})).toBeNull();
    expect(extractFailedPluginName({ message: undefined })).toBeNull();
    expect(extractFailedPluginName(42)).toBeNull();
  });
});

describe("issue #46 + #84: oxlint include-path batching", () => {
  it("SPAWN_ARGS_MAX_LENGTH_CHARS leaves headroom under Windows CreateProcessW (32_767)", () => {
    expect(SPAWN_ARGS_MAX_LENGTH_CHARS).toBeLessThan(32_767);
    expect(SPAWN_ARGS_MAX_LENGTH_CHARS).toBeGreaterThan(8_000);
  });

  it("OXLINT_MAX_FILES_PER_BATCH is small enough to avoid SIGABRT on large file sets", () => {
    // oxlint 1.50.0 was crashing at ~70 files with 2.8GB RAM. Stay safely below.
    expect(OXLINT_MAX_FILES_PER_BATCH).toBeGreaterThanOrEqual(50);
    expect(OXLINT_MAX_FILES_PER_BATCH).toBeLessThanOrEqual(1_000);
  });

  it("batchIncludePaths splits when it would exceed OXLINT_MAX_FILES_PER_BATCH", () => {
    const baseArgs = ["oxlint", "-c", "/tmp/oxlintrc.json", "--format", "json"];
    const includePaths = Array.from(
      { length: OXLINT_MAX_FILES_PER_BATCH * 2 + 5 },
      (_, index) => `src/file-${index}.tsx`,
    );
    const batches = batchIncludePaths(baseArgs, includePaths);

    expect(batches.length).toBe(3);
    expect(batches[0]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[1]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[2]).toHaveLength(5);
    expect(batches.flat()).toEqual(includePaths);
  });

  it("batchIncludePaths splits when paths would exceed SPAWN_ARGS_MAX_LENGTH_CHARS (Windows ENAMETOOLONG)", () => {
    const baseArgs = ["oxlint", "-c", "/tmp/oxlintrc.json", "--format", "json"];
    // Each path is 200 chars; 200 paths = ~40k chars, well past Windows
    // CreateProcessW's 32_767 limit. Must split into at least 2 batches.
    const longSegment = "a".repeat(180);
    const includePaths = Array.from(
      { length: 200 },
      (_, index) => `src/${longSegment}-${index}.tsx`,
    );

    const batches = batchIncludePaths(baseArgs, includePaths);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const totalChars = batch.reduce(
        (total, current) => total + current.length + 1,
        baseArgs.reduce((total, current) => total + current.length + 1, 0),
      );
      expect(totalChars).toBeLessThanOrEqual(SPAWN_ARGS_MAX_LENGTH_CHARS);
    }
    expect(batches.flat()).toEqual(includePaths);
  });

  it("batchIncludePaths returns a single batch for small inputs and [] for empty", () => {
    expect(batchIncludePaths(["oxlint"], [])).toEqual([]);
    expect(batchIncludePaths(["oxlint"], ["src/a.tsx", "src/b.tsx"])).toEqual([
      ["src/a.tsx", "src/b.tsx"],
    ]);
  });
});

describe("issue #53: source file count fallback for non-git directories", () => {
  it("returns a non-zero count for a non-git project containing .tsx files", () => {
    const projectDir = path.join(tempRoot, "issue-53-non-git");
    fs.mkdirSync(path.join(projectDir, "src", "nested"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "non-git",
      dependencies: { react: "^19.0.0" },
    });
    writeFile(path.join(projectDir, "src", "App.tsx"), "export const App = () => null;\n");
    writeFile(
      path.join(projectDir, "src", "nested", "Component.tsx"),
      "export const Component = () => null;\n",
    );
    writeFile(path.join(projectDir, "src", "utils.ts"), "export const x = 1;\n");
    expect(fs.existsSync(path.join(projectDir, ".git"))).toBe(false);

    const projectInfo = discoverProject(projectDir);
    expect(projectInfo.sourceFileCount).toBeGreaterThanOrEqual(3);
  });
});

describe("issue #89: --offline produces a score calculated locally", () => {
  it("calculateScoreLocally returns a non-null score with a valid label", () => {
    const score = calculateScoreLocally([
      buildDiagnostic({ severity: "error", rule: "rule-a" }),
      buildDiagnostic({ severity: "warning", rule: "rule-b" }),
      buildDiagnostic({ severity: "warning", rule: "rule-b" }), // duplicate rule, dedup'd
    ]);
    expect(score).not.toBeNull();
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(["Great", "Needs work", "Critical"]).toContain(score.label);
  });

  it("returns 100/Great when there are no diagnostics", () => {
    expect(calculateScoreLocally([])).toEqual({ score: 100, label: "Great" });
  });

  it("does not require any network access", async () => {
    // Sanity: no `fetch` involvement in the local scoring path.
    const calculateSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../src/core/calculate-score-locally.ts"),
      "utf8",
    );
    expect(calculateSource).not.toContain("fetch(");
    expect(calculateSource).not.toContain("api/score");
  });
});

describe("issue #115: --staged uses git INDEX content, not working tree", () => {
  it("getStagedSourceFiles returns staged JSX/TSX paths from the index", () => {
    const repoDir = path.join(tempRoot, "issue-115-paths");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "staged-paths" });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const App = () => null;\n");
    writeFile(path.join(repoDir, "src", "ignored.txt"), "not source");

    initGitRepo(repoDir);
    spawnSync("git", ["add", "src/App.tsx", "src/ignored.txt"], { cwd: repoDir });

    const stagedFiles = getStagedSourceFiles(repoDir);
    expect(stagedFiles).toContain("src/App.tsx");
    expect(stagedFiles).not.toContain("src/ignored.txt");
  });

  it("materializeStagedFiles snapshots INDEX content even when working tree differs", () => {
    const repoDir = path.join(tempRoot, "issue-115-snapshot");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "staged-snapshot" });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const ORIGINAL = 1;\n");

    initGitRepo(repoDir);
    spawnSync("git", ["add", "src/App.tsx"], { cwd: repoDir });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });

    // Stage new content, then mutate the working tree on top of the staged version.
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const STAGED = 2;\n");
    spawnSync("git", ["add", "src/App.tsx"], { cwd: repoDir });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const WORKING_TREE = 3;\n");

    const stagedFiles = getStagedSourceFiles(repoDir);
    expect(stagedFiles).toEqual(["src/App.tsx"]);

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-snapshot-"));
    const snapshot = materializeStagedFiles(repoDir, stagedFiles, tempDirectory);
    try {
      const snapshotted = fs.readFileSync(
        path.join(snapshot.tempDirectory, "src", "App.tsx"),
        "utf8",
      );
      expect(snapshotted).toContain("STAGED");
      expect(snapshotted).not.toContain("WORKING_TREE");
    } finally {
      snapshot.cleanup();
    }
  });

  it("getStagedSourceFiles returns [] for a repo with nothing staged", () => {
    const repoDir = path.join(tempRoot, "issue-115-empty");
    fs.mkdirSync(repoDir, { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "empty-staged" });
    initGitRepo(repoDir);
    expect(getStagedSourceFiles(repoDir)).toEqual([]);
  });
});

describe("issue #149: empty pattern strings cannot reach knip's picomatch matchers", () => {
  it("strips empty/whitespace-only patterns from arrays, scalars, and nested plugin configs", () => {
    const parsedConfig: Record<string, unknown> = {
      entry: ["src/index.ts", "", "  "],
      project: "",
      ignore: ["", "node_modules/**"],
      vite: { config: ["", "vite.config.ts"], entry: "  " },
      workspaces: {
        "packages/foo": { entry: ["", "src/index.ts"], ignore: "" },
      },
    };

    sanitizeKnipConfigPatterns(parsedConfig);

    expect(parsedConfig).toEqual({
      entry: ["src/index.ts"],
      ignore: ["node_modules/**"],
      vite: { config: ["vite.config.ts"] },
      workspaces: {
        "packages/foo": { entry: ["src/index.ts"] },
      },
    });
  });
});

describe("issue #141: oxlint config must not reference unloaded plugins", () => {
  // HACK: the bug only fires when eslint-plugin-react-hooks is missing
  // AND React Compiler is detected — so REACT_COMPILER_RULES (under the
  // `react-hooks-js` namespace) gets injected without the plugin
  // entry, and oxlint errors out with "react-hooks-js not found".
  // We assert the invariant directly on the produced config: every
  // plugin namespace referenced in `rules` must be loaded as a builtin
  // plugin (in `plugins`) or as a JS plugin (in `jsPlugins`).
  const collectReferencedPluginNames = (rules: Record<string, unknown>): Set<string> => {
    const pluginNames = new Set<string>();
    for (const ruleKey of Object.keys(rules)) {
      const slashIndex = ruleKey.indexOf("/");
      if (slashIndex <= 0) continue;
      pluginNames.add(ruleKey.slice(0, slashIndex));
    }
    return pluginNames;
  };

  // The `react-doctor` plugin itself is loaded by file path (jsPlugins
  // entry is a string); oxlint reads the plugin's self-declared
  // `meta.name` at load time. Treat it as always loaded for this check.
  const PLUGIN_NAMES_LOADED_BY_FILE_PATH = new Set<string>(["react-doctor"]);

  const collectLoadedPluginNames = (config: ReturnType<typeof createOxlintConfig>): Set<string> => {
    const loaded = new Set<string>(config.plugins);
    for (const pluginName of PLUGIN_NAMES_LOADED_BY_FILE_PATH) loaded.add(pluginName);
    for (const jsPlugin of config.jsPlugins) {
      if (typeof jsPlugin === "string") continue;
      loaded.add(jsPlugin.name);
    }
    return loaded;
  };

  it("rules never reference a plugin that isn't in plugins or jsPlugins", () => {
    const allCombinations = [
      { hasReactCompiler: true, hasTanStackQuery: true, framework: "nextjs" as const },
      { hasReactCompiler: true, hasTanStackQuery: false, framework: "expo" as const },
      { hasReactCompiler: false, hasTanStackQuery: true, framework: "tanstack-start" as const },
      { hasReactCompiler: false, hasTanStackQuery: false, framework: "unknown" as const },
    ];
    for (const combination of allCombinations) {
      const config = createOxlintConfig({
        pluginPath: "/tmp/react-doctor-plugin.js",
        project: buildTestProject({ rootDirectory: "/tmp/test", ...combination }),
      });
      const referencedPluginNames = collectReferencedPluginNames(config.rules);
      const loadedPluginNames = collectLoadedPluginNames(config);
      const unloadedReferenced = [...referencedPluginNames].filter(
        (pluginName) => !loadedPluginNames.has(pluginName),
      );
      expect(unloadedReferenced).toEqual([]);
    }
  });

  it("REACT_COMPILER_RULES are gated on react-hooks-js plugin resolution", () => {
    // When eslint-plugin-react-hooks IS resolvable from react-doctor,
    // REACT_COMPILER_RULES should
    // appear AND `react-hooks-js` must be in jsPlugins by name.
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
    });

    const reactHooksJsRuleKeys = Object.keys(config.rules).filter((ruleKey) =>
      ruleKey.startsWith("react-hooks-js/"),
    );
    const hasReactHooksJsPluginEntry = config.jsPlugins.some(
      (jsPlugin) => typeof jsPlugin === "object" && jsPlugin.name === "react-hooks-js",
    );

    expect(hasReactHooksJsPluginEntry).toBe(true);
    expect(reactHooksJsRuleKeys.length).toBeGreaterThan(0);
    expect(reactHooksJsRuleKeys.every((ruleKey) => config.rules[ruleKey] === "error")).toBe(true);
  });

  it("emits no react-hooks-js rules when customRulesOnly skips the plugin", () => {
    // customRulesOnly forces resolveReactHooksJsPlugin to return null
    // even when the package is installed, so this case proves the gating
    // works without uninstalling a workspace dependency.
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
      customRulesOnly: true,
    });

    const reactHooksJsRuleKeys = Object.keys(config.rules).filter((ruleKey) =>
      ruleKey.startsWith("react-hooks-js/"),
    );
    const hasReactHooksJsPluginEntry = config.jsPlugins.some(
      (jsPlugin) => typeof jsPlugin === "object" && jsPlugin.name === "react-hooks-js",
    );

    expect(reactHooksJsRuleKeys).toHaveLength(0);
    expect(hasReactHooksJsPluginEntry).toBe(false);
  });

  it("emits every react-hooks-js rule at error severity (so they fail CI under --fail-on error)", () => {
    // Regression for the silent severity downgrade introduced in PR
    // #140: every `react-hooks-js/*` entry got mass-converted from
    // `"error"` to `"warn"`, which made "React Compiler can't optimize
    // this code" diagnostics stop counting toward `errorCount` and
    // stop tripping the GitHub Action's default `--fail-on error`.
    // Each compiler diagnostic represents an unoptimizable component
    // shape — surfacing as warnings hid real perf regressions.
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
    });

    const compilerSeverities = Object.entries(config.rules)
      .filter(([ruleKey]) => ruleKey.startsWith("react-hooks-js/"))
      .map(([ruleKey, severity]) => ({ ruleKey, severity }));

    expect(compilerSeverities.length).toBeGreaterThan(0);
    const nonErrorEntries = compilerSeverities.filter((entry) => entry.severity !== "error");
    expect(nonErrorEntries).toEqual([]);
  });

  it("only enables react-hooks-js rules that the resolved plugin actually exports", async () => {
    // The workspace pins eslint-plugin-react-hooks@7, so every
    // configured react-hooks-js/* rule MUST exist in the loaded
    // module's `rules` map. A future plugin upgrade that drops one of
    // our rules would otherwise sneak past unit tests and crash
    // real-world scans with "Rule '<name>' not found in plugin
    // 'react-hooks-js'".
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
    });
    const pluginModule = await import("eslint-plugin-react-hooks");
    const availableRuleNames = new Set(
      Object.keys((pluginModule.default ?? pluginModule).rules ?? {}),
    );
    const enabledRuleNames = Object.keys(config.rules)
      .filter((ruleKey) => ruleKey.startsWith("react-hooks-js/"))
      .map((ruleKey) => ruleKey.replace(/^react-hooks-js\//, ""));
    expect(enabledRuleNames.length).toBeGreaterThan(0);
    for (const ruleName of enabledRuleNames) {
      expect(availableRuleNames.has(ruleName)).toBe(true);
    }
  });

  it("loads eslint-plugin-react-you-might-not-need-an-effect when installed (#187)", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
    });

    const effectRuleKeys = Object.keys(config.rules).filter((ruleKey) =>
      ruleKey.startsWith("effect/"),
    );
    const hasEffectPluginEntry = config.jsPlugins.some(
      (jsPlugin) => typeof jsPlugin === "object" && jsPlugin.name === "effect",
    );

    expect(hasEffectPluginEntry).toBe(true);
    expect(effectRuleKeys.length).toBeGreaterThan(0);
    expect(effectRuleKeys.every((ruleKey) => config.rules[ruleKey] === "warn")).toBe(true);
  });

  it("emits no effect/* rules when customRulesOnly skips third-party plugins (#187)", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
      customRulesOnly: true,
    });

    const effectRuleKeys = Object.keys(config.rules).filter((ruleKey) =>
      ruleKey.startsWith("effect/"),
    );
    const hasEffectPluginEntry = config.jsPlugins.some(
      (jsPlugin) => typeof jsPlugin === "object" && jsPlugin.name === "effect",
    );

    expect(effectRuleKeys).toHaveLength(0);
    expect(hasEffectPluginEntry).toBe(false);
  });

  it("only enables effect/* rules that the resolved plugin actually exports (#187)", async () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
    });
    const pluginModule = await import("eslint-plugin-react-you-might-not-need-an-effect");
    const availableRuleNames = new Set(
      Object.keys((pluginModule.default ?? pluginModule).rules ?? {}),
    );
    const enabledRuleNames = Object.keys(config.rules)
      .filter((ruleKey) => ruleKey.startsWith("effect/"))
      .map((ruleKey) => ruleKey.replace(/^effect\//, ""));
    expect(enabledRuleNames.length).toBeGreaterThan(0);
    for (const ruleName of enabledRuleNames) {
      expect(availableRuleNames.has(ruleName)).toBe(true);
    }
  });
});
