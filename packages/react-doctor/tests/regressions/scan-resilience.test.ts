/**
 * Regression tests for scan-pipeline robustness — the issues here all
 * stemmed from a runtime crash, silent failure, or "all results lost on
 * one bad input" failure mode.
 *
 * Covered closed issues:
 *   #46 + #84 — oxlint must batch include-paths so a 1k+-file diff
 *               (Windows ENAMETOOLONG) or 70+ test file batch (oxlint
 *               SIGABRT @ 2.8GB RAM) doesn't blow up
 *   #53  — source file count must fall back to filesystem walk when not
 *          inside a git repo
 *   #115 — `--staged` snapshots git INDEX content (not working tree) so
 *          partially-staged hunks behave correctly
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

import {
  batchIncludePaths,
  createOxlintConfig,
  OXLINT_MAX_FILES_PER_BATCH,
  SPAWN_ARGS_MAX_LENGTH_CHARS,
} from "@react-doctor/core";
import {
  clearPackageJsonCache,
  discoverProject,
  discoverReactSubprojects,
  isDirectory,
  readDirectoryEntries,
  readPackageJson,
} from "@react-doctor/core";
import {
  getStagedSourceFiles,
  materializeStagedFiles,
} from "../../src/cli/utils/get-staged-files.js";
import { buildTestProject, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-scan-resilience-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
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

  it("batchIncludePaths keeps an exact OXLINT_MAX_FILES_PER_BATCH boundary in one batch", () => {
    const baseArgs = ["oxlint", "-c", "/tmp/oxlintrc.json", "--format", "json"];
    const includePaths = Array.from(
      { length: OXLINT_MAX_FILES_PER_BATCH },
      (_, index) => `src/exact-${index}.tsx`,
    );

    const batches = batchIncludePaths(baseArgs, includePaths);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(includePaths);
  });

  it("batchIncludePaths never drops paths when splitting long mixed path sets", () => {
    const baseArgs = ["oxlint", "-c", "/tmp/oxlintrc.json", "--format", "json"];
    const longSegment = "nested-directory".repeat(12);
    const includePaths = Array.from({ length: 350 }, (_, index) =>
      index % 2 === 0 ? `src/${longSegment}/file-${index}.tsx` : `src/file-${index}.tsx`,
    );

    const batches = batchIncludePaths(baseArgs, includePaths);

    expect(batches.length).toBeGreaterThan(1);
    expect(new Set(batches.flat()).size).toBe(includePaths.length);
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

describe("issue #275 + #290: filesystem walks tolerate EPERM/EACCES (macOS Library/Accounts)", () => {
  // On macOS, certain directories like ~/Library/Accounts are protected
  // by TCC and throw EPERM on readdir even for the owning user. If the
  // CLI is run from a parent directory (e.g. $HOME), the recursive
  // discovery walk would crash the entire scan with:
  //   EPERM: operation not permitted, scandir '/Users/<user>/Library/Accounts'
  // The fix swallows ignorable readdir errors (EPERM, EACCES, ENOENT,
  // ENOTDIR) and continues the walk so a single unreadable directory
  // can't take down the whole run.
  it("readDirectoryEntries returns [] for a non-existent path", () => {
    const missingDirectory = path.join(tempRoot, "issue-275-missing-directory");
    expect(readDirectoryEntries(missingDirectory)).toEqual([]);
  });

  it("readDirectoryEntries returns [] for a path that points at a file (ENOTDIR)", () => {
    const filePath = path.join(tempRoot, "issue-275-not-a-directory.txt");
    writeFile(filePath, "not a directory\n");
    expect(readDirectoryEntries(filePath)).toEqual([]);
  });

  // Posix permission bits behave the way we expect on linux + macOS in CI.
  // Skipped on Windows where chmod 0 doesn't deny readdir to the owner.
  it("readDirectoryEntries returns [] for an unreadable directory (EACCES) on posix", () => {
    if (process.platform === "win32") return;
    if (process.getuid?.() === 0) return;

    const unreadableDirectory = path.join(tempRoot, "issue-275-unreadable");
    fs.mkdirSync(unreadableDirectory, { recursive: true });
    fs.writeFileSync(path.join(unreadableDirectory, "child.txt"), "hidden\n");
    fs.chmodSync(unreadableDirectory, 0o000);
    try {
      expect(readDirectoryEntries(unreadableDirectory)).toEqual([]);
    } finally {
      fs.chmodSync(unreadableDirectory, 0o755);
    }
  });

  it("discoverReactSubprojects skips unreadable nested directories and keeps walking", () => {
    if (process.platform === "win32") return;
    if (process.getuid?.() === 0) return;

    const walkRoot = path.join(tempRoot, "issue-275-walk-root");
    fs.mkdirSync(walkRoot, { recursive: true });

    writeJson(path.join(walkRoot, "accessible-app", "package.json"), {
      name: "accessible-app",
      dependencies: { react: "^19.0.0" },
    });

    const unreadableSibling = path.join(walkRoot, "Library", "Accounts");
    fs.mkdirSync(unreadableSibling, { recursive: true });
    fs.chmodSync(unreadableSibling, 0o000);

    try {
      const subprojects = discoverReactSubprojects(walkRoot);
      const subprojectNames = subprojects.map((subproject) => subproject.name);
      expect(subprojectNames).toContain("accessible-app");
    } finally {
      fs.chmodSync(unreadableSibling, 0o755);
    }
  });

  // Same root cause as the readdir crash, one level deeper: when the
  // walk reaches a package.json under a TCC-protected directory, the
  // subsequent fs.readFileSync would throw EPERM and bring down the
  // whole scan. Mirror EISDIR/EACCES handling for EPERM (macOS TCC)
  // and ENOENT (race during long walks) so the unreadable manifest
  // gets treated as an empty package.json instead of a fatal error.
  it("readPackageJson returns {} for an unreadable manifest (EPERM/EACCES) on posix", () => {
    if (process.platform === "win32") return;
    if (process.getuid?.() === 0) return;

    const projectDir = path.join(tempRoot, "issue-275-unreadable-manifest");
    fs.mkdirSync(projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, "package.json");
    writeJson(manifestPath, { name: "hidden", dependencies: { react: "^19.0.0" } });
    clearPackageJsonCache();
    fs.chmodSync(manifestPath, 0o000);
    try {
      expect(readPackageJson(manifestPath)).toEqual({});
    } finally {
      fs.chmodSync(manifestPath, 0o644);
      clearPackageJsonCache();
    }
  });

  it("readPackageJson returns {} when the manifest no longer exists (ENOENT)", () => {
    const missingPath = path.join(tempRoot, "issue-275-missing-manifest", "package.json");
    clearPackageJsonCache();
    expect(readPackageJson(missingPath)).toEqual({});
  });

  // Resolves the unsafe `fs.existsSync && fs.statSync().isDirectory()`
  // pattern that throws on EPERM if existsSync somehow returned true
  // but statSync was denied (narrow race / TCC interaction).
  it("isDirectory returns false rather than throwing for an inaccessible path", () => {
    if (process.platform === "win32") return;
    if (process.getuid?.() === 0) return;

    const outerDirectory = path.join(tempRoot, "issue-275-isdir-outer");
    const childDirectory = path.join(outerDirectory, "child");
    fs.mkdirSync(childDirectory, { recursive: true });
    fs.chmodSync(outerDirectory, 0o000);
    try {
      expect(isDirectory(childDirectory)).toBe(false);
    } finally {
      fs.chmodSync(outerDirectory, 0o755);
    }
  });
});

describe("issue #115: --staged uses git INDEX content, not working tree", () => {
  it("getStagedSourceFiles returns staged JSX/TSX paths from the index", async () => {
    const repoDir = path.join(tempRoot, "issue-115-paths");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "staged-paths" });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const App = () => null;\n");
    writeFile(path.join(repoDir, "src", "ignored.txt"), "not source");

    initGitRepo(repoDir);
    spawnSync("git", ["add", "src/App.tsx", "src/ignored.txt"], { cwd: repoDir });

    const stagedFiles = await getStagedSourceFiles(repoDir);
    expect(stagedFiles).toContain("src/App.tsx");
    expect(stagedFiles).not.toContain("src/ignored.txt");
  });

  it("materializeStagedFiles snapshots INDEX content even when working tree differs", async () => {
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

    const stagedFiles = await getStagedSourceFiles(repoDir);
    expect(stagedFiles).toEqual(["src/App.tsx"]);

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-snapshot-"));
    const snapshot = await materializeStagedFiles(repoDir, stagedFiles, tempDirectory);
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

  it("getStagedSourceFiles returns [] for a repo with nothing staged", async () => {
    const repoDir = path.join(tempRoot, "issue-115-empty");
    fs.mkdirSync(repoDir, { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "empty-staged" });
    initGitRepo(repoDir);
    await expect(getStagedSourceFiles(repoDir)).resolves.toEqual([]);
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
    // When eslint-plugin-react-hooks IS resolvable from the project,
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

  it("honors top-level off overrides before registering react-hooks-js rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
      severityControls: {
        rules: { "react-hooks-js/void-use-memo": "off" },
      },
    });

    expect(config.rules["react-hooks-js/void-use-memo"]).toBeUndefined();
    expect(Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("react-hooks-js/"))).toBe(
      true,
    );
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
    // Every configured react-hooks-js/* rule MUST exist in the loaded
    // native plugin's `rules` map. A future plugin change that drops one
    // of our rules would otherwise sneak past unit tests and crash
    // real-world scans with "Rule '<name>' not found in plugin
    // 'react-hooks-js'".
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
    });
    const pluginModule = await import("@react-doctor/compiler-native/plugin.js");
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

  it("ships the 8 ported `you-might-not-need-an-effect` rules as react-doctor rules", () => {
    // After the native port (#187 follow-up), the previously-external
    // `effect/*` rule surface lives inside `oxlint-plugin-react-doctor`
    // as plain `react-doctor/*` global rules. No JS plugin entry, no
    // separate `effect/` namespace, no optional peer dependency.
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
    });

    // `no-adjust-state-on-prop-change` is intentionally promoted to
    // `error` — the pattern always causes an extra render with a stale
    // UI between commits, there is no benign instance. See SOURCE.md.
    const portedRuleSeverity: Record<string, "warn" | "error"> = {
      "no-derived-state": "warn",
      "no-chain-state-updates": "warn",
      "no-event-handler": "warn",
      "no-adjust-state-on-prop-change": "error",
      "no-reset-all-state-on-prop-change": "warn",
      "no-pass-live-state-to-parent": "warn",
      "no-pass-data-to-parent": "warn",
      "no-initialize-state": "warn",
    };
    for (const [ruleId, expectedSeverity] of Object.entries(portedRuleSeverity)) {
      const fullKey = `react-doctor/${ruleId}`;
      expect(config.rules[fullKey]).toBe(expectedSeverity);
    }

    expect(Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("effect/"))).toBe(false);
    expect(
      config.jsPlugins.some(
        (jsPlugin) => typeof jsPlugin === "object" && jsPlugin.name === "effect",
      ),
    ).toBe(false);
  });

  it("customRulesOnly still excludes the ported effect rule family", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
      customRulesOnly: true,
    });

    const portedRuleIds = [
      "no-derived-state",
      "no-chain-state-updates",
      "no-event-handler",
      "no-adjust-state-on-prop-change",
      "no-reset-all-state-on-prop-change",
      "no-pass-live-state-to-parent",
      "no-pass-data-to-parent",
      "no-initialize-state",
    ];
    for (const ruleId of portedRuleIds) {
      expect(config.rules[`react-doctor/${ruleId}`]).toBeUndefined();
    }
  });

  // The four `jsx-no-new-*-as-prop` perf rules guard against a footgun
  // (new array/object/function/JSX as a prop breaks downstream
  // `React.memo`) that React Compiler auto-fixes at compile time. When
  // RC is in scope they're unactionable noise, so they ship with
  // `disabledBy: ["react-compiler"]` and the gate must drop them.
  it("disables react-compiler-redundant perf rules when React Compiler is detected", () => {
    const reactCompilerGatedRules = [
      "react-doctor/jsx-no-new-object-as-prop",
      "react-doctor/jsx-no-new-array-as-prop",
      "react-doctor/jsx-no-new-function-as-prop",
      "react-doctor/jsx-no-jsx-as-prop",
    ];

    const withoutCompiler = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: false }),
    });
    for (const ruleKey of reactCompilerGatedRules) {
      expect(withoutCompiler.rules[ruleKey]).toBe("warn");
    }

    const withCompiler = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
    });
    for (const ruleKey of reactCompilerGatedRules) {
      expect(withCompiler.rules[ruleKey]).toBeUndefined();
    }
  });

  // The inverse of the rule above: `react-compiler-no-manual-memoization`
  // is gated with `requires: ["react-compiler"]` so it ONLY fires once
  // the project ships with React Compiler. Without the compiler, manual
  // `useMemo` / `useCallback` / `memo()` are still legitimate perf
  // tools — the gate must keep the rule out of the default config. With
  // the compiler it ships as a `warn` (redundant-memo cleanup is hidden in
  // the default report); the `compiler-cleanup` bucket re-enables errors.
  it("ships react-compiler-no-manual-memoization as a warning, gated on React Compiler", () => {
    const ruleKey = "react-doctor/react-compiler-no-manual-memoization";

    const withoutCompiler = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: false }),
    });
    expect(withoutCompiler.rules[ruleKey]).toBeUndefined();

    const withCompiler = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
    });
    expect(withCompiler.rules[ruleKey]).toBe("warn");

    const withCompilerCleanupBucket = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test", hasReactCompiler: true }),
      severityControls: { buckets: { "compiler-cleanup": "error" } },
    });
    expect(withCompilerCleanupBucket.rules[ruleKey]).toBe("error");
  });

  // The three noisy upstream rules ship `defaultEnabled: false` —
  // they're imported and runnable, but the default config skips them.
  // Users opt in via `severityControls.rules`.
  it("default-disabled rules are off until explicitly enabled via severityControls", () => {
    const defaultDisabledRules = [
      "react-doctor/react-in-jsx-scope",
      "react-doctor/forbid-component-props",
      "react-doctor/jsx-props-no-spreading",
    ];

    const defaultConfig = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
    });
    for (const ruleKey of defaultDisabledRules) {
      expect(defaultConfig.rules[ruleKey]).toBeUndefined();
    }

    const optedInConfig = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: buildTestProject({ rootDirectory: "/tmp/test" }),
      severityControls: {
        rules: Object.fromEntries(defaultDisabledRules.map((ruleKey) => [ruleKey, "warn"])),
      },
    });
    for (const ruleKey of defaultDisabledRules) {
      expect(optedInConfig.rules[ruleKey]).toBe("warn");
    }
  });

  // Bugbot #fa3d54f2: `RECOMMENDED_RULES` / `NEXTJS_RULES` / etc. (the
  // ESLint flat-config presets exported by `oxlint-plugin-react-doctor`
  // and consumed by `eslint-plugin-react-doctor`) used to include
  // every `framework: global` rule regardless of `defaultEnabled`. The
  // oxlint config builder honored the flag but the ESLint presets
  // didn't, so ESLint users on the `recommended` preset would
  // silently get every default-disabled rule. Regression test: confirm
  // none of the default-disabled rules leak into the recommended set.
  it("RECOMMENDED_RULES (ESLint preset) honors `defaultEnabled: false`", async () => {
    const pluginModule = await import("oxlint-plugin-react-doctor");
    const recommendedRuleKeys = new Set(Object.keys(pluginModule.RECOMMENDED_RULES));
    const defaultDisabledRules = [
      "react-doctor/react-in-jsx-scope",
      "react-doctor/forbid-component-props",
      "react-doctor/jsx-props-no-spreading",
      "react-doctor/no-unescaped-entities",
      "react-doctor/jsx-boolean-value",
      "react-doctor/jsx-curly-brace-presence",
      "react-doctor/self-closing-comp",
      "react-doctor/jsx-no-useless-fragment",
      "react-doctor/display-name",
      "react-doctor/no-set-state",
      "react-doctor/no-clone-element",
      "react-doctor/hook-use-state",
      "react-doctor/jsx-handler-names",
      "react-doctor/prefer-function-component",
      "react-doctor/jsx-fragments",
      "react-doctor/state-in-constructor",
      "react-doctor/jsx-filename-extension",
      "react-doctor/no-react-children",
    ];
    for (const ruleKey of defaultDisabledRules) {
      expect(recommendedRuleKeys.has(ruleKey)).toBe(false);
    }
  });
});
