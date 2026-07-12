import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearConfigCache, type Diagnostic } from "@react-doctor/core";
import { inspect, type ResolvedInspectOptions } from "../src/inspect.js";
import {
  buildScanResultCacheKey,
  createScanResultCache,
  shouldStoreScanPayload,
  type CachedScanPayload,
} from "../src/cli/utils/scan-result-cache.js";
import {
  SCAN_RESULT_CACHE_MAX_DIRTY_STATUS_ENTRY_COUNT,
  SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES,
} from "../src/cli/utils/constants.js";
import { runGit } from "../src/cli/utils/git-hook-shared.js";
import { VERSION } from "../src/cli/utils/version.js";
import { commitAll, initGitRepo, setupReactProject } from "./regressions/_helpers.js";

let tempDirectory: string;

const baseOptions = (overrides: Partial<ResolvedInspectOptions> = {}): ResolvedInspectOptions => ({
  lint: false,
  deadCode: false,
  supplyChain: true,
  verbose: false,
  scoreOnly: false,
  noScore: true,
  isCi: false,
  isCiOrCodingAgentEnvironment: false,
  isNonInteractiveEnvironment: false,
  silent: true,
  includePaths: [],
  customRulesOnly: false,
  share: true,
  respectInlineDisables: true,
  warnings: true,
  adoptExistingLintConfig: true,
  ignoredTags: new Set<string>(),
  outputSurface: "cli",
  suppressRendering: false,
  concurrency: undefined,
  baseline: null,
  supplyChainManifestChanged: false,
  ...overrides,
});

const cacheKey = (
  projectDirectory: string,
  options: ResolvedInspectOptions,
  version = VERSION,
  nodeBinaryPath: string | null = null,
): string | null =>
  buildScanResultCacheKey({
    projectDirectory,
    version,
    nodeBinaryPath,
    options,
    userConfig: null,
    hasConfigOverride: false,
    configSourceDirectory: null,
  });

const diagnostic = (projectDirectory: string): Diagnostic => ({
  filePath: path.join(projectDirectory, "src", "App.tsx"),
  plugin: "react-doctor",
  rule: "cached-rule",
  severity: "warning",
  message: "cached diagnostic",
  help: "cached help",
  line: 1,
  column: 1,
  category: "Correctness",
});

const basePayload = (
  projectDirectory: string,
  overrides: Partial<CachedScanPayload> = {},
): CachedScanPayload => ({
  diagnostics: [diagnostic(projectDirectory)],
  score: null,
  project: {
    rootDirectory: projectDirectory,
    projectName: "hit",
    reactVersion: "^19.0.0",
    reactMajorVersion: 19,
    tailwindVersion: null,
    zodVersion: null,
    zodMajorVersion: null,
    framework: "unknown",
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
    isPreES2023Target: false,
    preactVersion: null,
    preactMajorVersion: null,
    sourceFileCount: 1,
  },
  userConfig: null,
  didLintFail: false,
  lintFailureReason: null,
  lintPartialFailures: [],
  didDeadCodeFail: false,
  deadCodeFailureReason: null,
  deadCodeOverlapped: false,
  directory: projectDirectory,
  scannedFileCount: 1,
  scannedFilePaths: [],
  scanElapsedMilliseconds: 1,
  baselineDelta: undefined,
  lintFailureReasonKind: null,
  supplyChainOverlapTimedOut: false,
  ...overrides,
});

beforeEach(() => {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-scan-cache-"));
  clearConfigCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearConfigCache();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("scan result cache", () => {
  it("returns cached payloads for the same clean project key", () => {
    const projectDirectory = setupReactProject(tempDirectory, "hit", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    const options = baseOptions();
    const key = cacheKey(projectDirectory, options);
    expect(key).not.toBeNull();
    if (key === null) return;

    const cache = createScanResultCache(projectDirectory);
    cache.store(key, basePayload(projectDirectory));

    expect(cache.lookup(key)?.diagnostics).toEqual([diagnostic(projectDirectory)]);
  });

  it("honors REACT_DOCTOR_CACHE_DIR so the action-persisted dir carries the scan cache", () => {
    const projectDirectory = setupReactProject(tempDirectory, "cache-dir-override", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    const overrideDirectory = path.join(tempDirectory, "ci-cache");
    const previousValue = process.env.REACT_DOCTOR_CACHE_DIR;
    try {
      process.env.REACT_DOCTOR_CACHE_DIR = overrideDirectory;
      const key = cacheKey(projectDirectory, baseOptions());
      expect(key).not.toBeNull();
      if (key === null) return;
      createScanResultCache(projectDirectory).store(key, basePayload(projectDirectory));

      const persistedFiles = fs.readdirSync(overrideDirectory, { recursive: true });
      expect(persistedFiles.some((entry) => String(entry).endsWith("scan-cache.json"))).toBe(true);
      expect(createScanResultCache(projectDirectory).lookup(key)).not.toBeNull();
    } finally {
      if (previousValue === undefined) delete process.env.REACT_DOCTOR_CACHE_DIR;
      else process.env.REACT_DOCTOR_CACHE_DIR = previousValue;
    }
  });

  it("keys identically across a fresh-checkout mtime bump of config and dotenv files", () => {
    const projectDirectory = setupReactProject(tempDirectory, "fresh-checkout", {
      files: {
        "src/App.tsx": "export const App = () => <div />;\n",
        "doctor.config.json": JSON.stringify({ warnings: true }),
        ".gitignore": ".env\n",
        ".env": "API_KEY=value\n",
      },
    });
    initGitRepo(projectDirectory, { commit: true });
    const keyBefore = cacheKey(projectDirectory, baseOptions());
    expect(keyBefore).not.toBeNull();

    // A fresh CI checkout re-creates every file: same bytes, new mtimes.
    const bumpedDate = new Date(Date.now() + 60_000);
    for (const fileName of ["package.json", "doctor.config.json", ".env"]) {
      fs.utimesSync(path.join(projectDirectory, fileName), bumpedDate, bumpedDate);
    }
    expect(cacheKey(projectDirectory, baseOptions())).toBe(keyBefore);
  });

  // The cache is deliberately NOT keyed on `--max-duration`: it's safe to serve
  // a stored payload to a budgeted run because only COMPLETE scans are ever
  // stored. A budget-truncated run (lint partial or dead-code skipped) must be
  // barred here, so a `--max-duration` cache hit can only ever be a complete
  // result — honoring the max budget without replaying a stale partial.
  it("never stores a budget-truncated (or otherwise incomplete) scan", () => {
    const directory = tempDirectory;
    expect(shouldStoreScanPayload(basePayload(directory))).toBe(true);
    expect(
      shouldStoreScanPayload(
        basePayload(directory, {
          lintPartialFailures: ["12 file(s) skipped — max scan duration reached (a.tsx, +11 more)"],
        }),
      ),
    ).toBe(false);
    expect(shouldStoreScanPayload(basePayload(directory, { didDeadCodeFail: true }))).toBe(false);
    expect(shouldStoreScanPayload(basePayload(directory, { didLintFail: true }))).toBe(false);
  });

  it("misses when commit, config, version, or selected files change", () => {
    const projectDirectory = setupReactProject(tempDirectory, "miss", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    const options = baseOptions();
    const originalKey = cacheKey(projectDirectory, options);
    expect(originalKey).not.toBeNull();

    expect(cacheKey(projectDirectory, options, "999.0.0")).not.toBe(originalKey);
    expect(cacheKey(projectDirectory, baseOptions({ includePaths: ["src/App.tsx"] }))).not.toBe(
      originalKey,
    );
    // `--no-supply-chain` must not share a key with a supply-chain-on run at the
    // same commit — the flag no longer rides the keyed `userConfig` blob.
    expect(cacheKey(projectDirectory, baseOptions({ supplyChain: false }))).not.toBe(originalKey);
    const alternateNodeBinaryPath = path.join(tempDirectory, "fake-node");
    fs.writeFileSync(alternateNodeBinaryPath, "node-a");
    expect(cacheKey(projectDirectory, options, VERSION, alternateNodeBinaryPath)).not.toBe(
      originalKey,
    );

    fs.writeFileSync(
      path.join(projectDirectory, "doctor.config.json"),
      JSON.stringify({ rules: {} }),
    );
    // An uncommitted config no longer bails the key — the dirty-worktree
    // fingerprint folds it in, so the key exists but differs from clean.
    expect(cacheKey(projectDirectory, options)).not.toBeNull();
    expect(cacheKey(projectDirectory, options)).not.toBe(originalKey);

    commitAll(projectDirectory, "config");
    const configCommitKey = cacheKey(projectDirectory, options);
    expect(configCommitKey).not.toBeNull();
    expect(configCommitKey).not.toBe(originalKey);

    fs.writeFileSync(
      path.join(projectDirectory, "src", "App.tsx"),
      "export const App = () => <main />;\n",
    );
    commitAll(projectDirectory, "source");
    expect(cacheKey(projectDirectory, options)).not.toBe(configCommitKey);
  });

  it("misses when the lint batch ordering changes", () => {
    // Batch ordering (`cost` vs `arrival`) can change which files trip the
    // spawn timeout and get dropped, so a `cost` payload must not be served to
    // an `arrival` lookup at the same commit.
    const projectDirectory = setupReactProject(tempDirectory, "ordering", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    const options = baseOptions();
    const previousOrdering = process.env.REACT_DOCTOR_LINT_BATCH_ORDERING;
    try {
      delete process.env.REACT_DOCTOR_LINT_BATCH_ORDERING;
      const defaultOrderingKey = cacheKey(projectDirectory, options);
      expect(defaultOrderingKey).not.toBeNull();
      // The default ordering is `cost`; rolling back to `arrival` must change the key.
      process.env.REACT_DOCTOR_LINT_BATCH_ORDERING = "arrival";
      expect(cacheKey(projectDirectory, options)).not.toBe(defaultOrderingKey);
    } finally {
      if (previousOrdering === undefined) {
        delete process.env.REACT_DOCTOR_LINT_BATCH_ORDERING;
      } else {
        process.env.REACT_DOCTOR_LINT_BATCH_ORDERING = previousOrdering;
      }
    }
  });

  it("honors REACT_DOCTOR_NO_CACHE", () => {
    const projectDirectory = setupReactProject(tempDirectory, "disabled", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    const previousValue = process.env.REACT_DOCTOR_NO_CACHE;
    try {
      process.env.REACT_DOCTOR_NO_CACHE = "true";
      expect(cacheKey(projectDirectory, baseOptions())).toBeNull();
    } finally {
      if (previousValue === undefined) {
        delete process.env.REACT_DOCTOR_NO_CACHE;
      } else {
        process.env.REACT_DOCTOR_NO_CACHE = previousValue;
      }
    }
  });

  it("does not cache when git hides tracked file changes", () => {
    const projectDirectory = setupReactProject(tempDirectory, "hidden-state", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    spawnSync("git", ["update-index", "--assume-unchanged", "src/App.tsx"], {
      cwd: projectDirectory,
    });

    expect(cacheKey(projectDirectory, baseOptions())).toBeNull();
  });

  it("does not cache a .git-less checkout git resolves to an enclosing repository", () => {
    // The mining/benchmark layout: an enclosing "runner" repo gitignores a
    // clones/ directory into which different projects are materialized at the
    // same path with .git stripped. Every git probe from the clone resolves
    // the runner repo — whose HEAD and worktree state cannot see the clone's
    // contents — so without the tracking-state gate two different projects at
    // this path key identically and replay each other's diagnostics.
    const runnerDirectory = path.join(tempDirectory, "runner");
    fs.mkdirSync(runnerDirectory, { recursive: true });
    fs.writeFileSync(path.join(runnerDirectory, ".gitignore"), "clones/\n");
    initGitRepo(runnerDirectory, { commit: true });
    const projectDirectory = setupReactProject(runnerDirectory, "clones/app", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });

    expect(cacheKey(projectDirectory, baseOptions())).toBeNull();
  });

  it("still caches a tracked workspace-member subdirectory", () => {
    const repositoryDirectory = path.join(tempDirectory, "workspace");
    fs.mkdirSync(repositoryDirectory, { recursive: true });
    const projectDirectory = setupReactProject(repositoryDirectory, "packages/app", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(repositoryDirectory, { commit: true });

    expect(cacheKey(projectDirectory, baseOptions())).not.toBeNull();
  });

  describe("replay verification", () => {
    it("misses when the manifest content changed since the payload was stored", () => {
      const projectDirectory = setupReactProject(tempDirectory, "manifest-drift", {
        files: { "src/App.tsx": "export const App = () => <div />;\n" },
      });
      initGitRepo(projectDirectory, { commit: true });
      const key = cacheKey(projectDirectory, baseOptions());
      expect(key).not.toBeNull();
      if (key === null) return;
      createScanResultCache(projectDirectory).store(key, basePayload(projectDirectory));
      expect(createScanResultCache(projectDirectory).lookup(key)).not.toBeNull();

      // A different project materialized at the same path (same cache key by
      // hypothesis of a keying bug) must read as a miss, not a replay.
      fs.writeFileSync(
        path.join(projectDirectory, "package.json"),
        JSON.stringify({ name: "different-project", dependencies: { react: "^19.0.0" } }),
      );
      expect(createScanResultCache(projectDirectory).lookup(key)).toBeNull();
    });

    it("misses when the stored payload describes another directory", () => {
      const projectDirectory = setupReactProject(tempDirectory, "directory-drift", {
        files: { "src/App.tsx": "export const App = () => <div />;\n" },
      });
      initGitRepo(projectDirectory, { commit: true });
      const key = cacheKey(projectDirectory, baseOptions());
      expect(key).not.toBeNull();
      if (key === null) return;
      const cache = createScanResultCache(projectDirectory);
      cache.store(
        key,
        basePayload(projectDirectory, { directory: path.join(tempDirectory, "elsewhere") }),
      );

      expect(cache.lookup(key)).toBeNull();
    });
  });

  it("handles git output larger than Node's default maxBuffer", () => {
    // `git ls-files -v` exceeds execFileSync's 1 MiB default on repos with
    // ~15-25k tracked files (getsentry/sentry: 1.25 MB); the resulting ENOBUFS
    // surfaced as `null`, which the cache gates read as hidden tracked state —
    // silently disabling the whole-repo cache on exactly the largest repos.
    // A shell alias emits 2 MiB through the production helper without needing
    // a giant fixture repo.
    const projectDirectory = setupReactProject(tempDirectory, "large-output", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });

    const outputSizeChars = 2 * 1024 * 1024;
    const nodeBinaryForShell = process.execPath.replaceAll("\\", "/");
    const output = runGit(projectDirectory, [
      "-c",
      `alias.emit-large-output=!"${nodeBinaryForShell}" -e "process.stdout.write('x'.repeat(${outputSizeChars}))"`,
      "emit-large-output",
    ]);
    expect(output?.length).toBe(outputSizeChars);
  });

  describe("dirty worktree fingerprint", () => {
    const setupCleanProject = (caseId: string): string => {
      const projectDirectory = setupReactProject(tempDirectory, caseId, {
        files: { "src/App.tsx": "export const App = () => <div />;\n" },
      });
      initGitRepo(projectDirectory, { commit: true });
      return projectDirectory;
    };

    it("keys a clean tree identically across runs", () => {
      const projectDirectory = setupCleanProject("clean-stable");
      const firstKey = cacheKey(projectDirectory, baseOptions());
      expect(firstKey).not.toBeNull();
      expect(cacheKey(projectDirectory, baseOptions())).toBe(firstKey);
    });

    it("keys an untracked file distinctly from clean, stably across identical states", () => {
      const projectDirectory = setupCleanProject("untracked");
      const cleanKey = cacheKey(projectDirectory, baseOptions());
      fs.writeFileSync(path.join(projectDirectory, "scratch.txt"), "x\n");
      const dirtyKey = cacheKey(projectDirectory, baseOptions());
      expect(dirtyKey).not.toBeNull();
      expect(dirtyKey).not.toBe(cleanKey);
      expect(cacheKey(projectDirectory, baseOptions())).toBe(dirtyKey);
    });

    it("misses when dirty content is edited, and rejoins the clean key when reverted", () => {
      const projectDirectory = setupCleanProject("edited");
      const cleanKey = cacheKey(projectDirectory, baseOptions());
      const appPath = path.join(projectDirectory, "src", "App.tsx");
      const committedSource = fs.readFileSync(appPath, "utf8");
      fs.writeFileSync(appPath, "export const App = () => <main />;\n");
      const firstDirtyKey = cacheKey(projectDirectory, baseOptions());
      expect(firstDirtyKey).not.toBeNull();
      expect(firstDirtyKey).not.toBe(cleanKey);
      fs.writeFileSync(appPath, "export const App = () => <section />;\n");
      const secondDirtyKey = cacheKey(projectDirectory, baseOptions());
      expect(secondDirtyKey).not.toBe(firstDirtyKey);
      expect(secondDirtyKey).not.toBe(cleanKey);
      fs.writeFileSync(appPath, committedSource);
      expect(cacheKey(projectDirectory, baseOptions())).toBe(cleanKey);
    });

    it("keys staged and unstaged states of the same content differently", () => {
      const projectDirectory = setupCleanProject("staged");
      fs.writeFileSync(
        path.join(projectDirectory, "src", "App.tsx"),
        "export const App = () => <main />;\n",
      );
      const unstagedKey = cacheKey(projectDirectory, baseOptions());
      spawnSync("git", ["add", "src/App.tsx"], { cwd: projectDirectory });
      const stagedKey = cacheKey(projectDirectory, baseOptions());
      expect(unstagedKey).not.toBeNull();
      expect(stagedKey).not.toBeNull();
      expect(stagedKey).not.toBe(unstagedKey);
    });

    it("keys a deleted file distinctly from clean and from a modified one", () => {
      const projectDirectory = setupCleanProject("deleted");
      const cleanKey = cacheKey(projectDirectory, baseOptions());
      const appPath = path.join(projectDirectory, "src", "App.tsx");
      fs.writeFileSync(appPath, "export const App = () => <main />;\n");
      const modifiedKey = cacheKey(projectDirectory, baseOptions());
      fs.rmSync(appPath);
      const deletedKey = cacheKey(projectDirectory, baseOptions());
      expect(deletedKey).not.toBeNull();
      expect(deletedKey).not.toBe(cleanKey);
      expect(deletedKey).not.toBe(modifiedKey);
      expect(cacheKey(projectDirectory, baseOptions())).toBe(deletedKey);
    });

    it("parses rename records (including paths with spaces) into a stable key", () => {
      const projectDirectory = setupCleanProject("renamed");
      const cleanKey = cacheKey(projectDirectory, baseOptions());
      spawnSync("git", ["mv", "src/App.tsx", "src/My App.tsx"], { cwd: projectDirectory });
      const renamedKey = cacheKey(projectDirectory, baseOptions());
      expect(renamedKey).not.toBeNull();
      expect(renamedKey).not.toBe(cleanKey);
      expect(cacheKey(projectDirectory, baseOptions())).toBe(renamedKey);
    });

    it("fingerprints files inside untracked directories individually", () => {
      const projectDirectory = setupCleanProject("untracked-dir");
      fs.mkdirSync(path.join(projectDirectory, "notes"));
      fs.writeFileSync(path.join(projectDirectory, "notes", "todo.txt"), "a\n");
      const firstKey = cacheKey(projectDirectory, baseOptions());
      expect(firstKey).not.toBeNull();
      fs.writeFileSync(path.join(projectDirectory, "notes", "todo.txt"), "b\n");
      expect(cacheKey(projectDirectory, baseOptions())).not.toBe(firstKey);
    });

    it("bails to null when the dirty set exceeds the entry bound", () => {
      const projectDirectory = setupCleanProject("oversized");
      const scratchDirectory = path.join(projectDirectory, "scratch");
      fs.mkdirSync(scratchDirectory);
      for (
        let fileIndex = 0;
        fileIndex <= SCAN_RESULT_CACHE_MAX_DIRTY_STATUS_ENTRY_COUNT;
        fileIndex += 1
      ) {
        fs.writeFileSync(path.join(scratchDirectory, `file-${fileIndex}.txt`), String(fileIndex));
      }
      expect(cacheKey(projectDirectory, baseOptions())).toBeNull();
    });

    it("disables caching when an oversized dirty file cannot be content-hashed", () => {
      const projectDirectory = setupCleanProject("oversized-file");
      const pluginPath = path.join(projectDirectory, "custom-rule.cjs");
      const fileSize = SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES + 1;
      fs.writeFileSync(pluginPath, "a".repeat(fileSize));
      const originalStat = fs.statSync(pluginPath);
      expect(cacheKey(projectDirectory, baseOptions())).toBeNull();

      fs.writeFileSync(pluginPath, "b".repeat(fileSize));
      fs.utimesSync(pluginPath, originalStat.atime, originalStat.mtime);
      expect(cacheKey(projectDirectory, baseOptions())).toBeNull();
    });

    it("keys gitignored dotenv files the security scan reads", () => {
      const projectDirectory = setupReactProject(tempDirectory, "dotenv", {
        files: {
          "src/App.tsx": "export const App = () => <div />;\n",
          ".gitignore": ".env\n",
          ".env": "API_KEY=first\n",
        },
      });
      initGitRepo(projectDirectory, { commit: true });
      const firstKey = cacheKey(projectDirectory, baseOptions());
      expect(firstKey).not.toBeNull();
      fs.writeFileSync(path.join(projectDirectory, ".env"), "API_KEY=second-value\n");
      expect(cacheKey(projectDirectory, baseOptions())).not.toBe(firstKey);
    });
  });

  it("reuses diagnostics when rerendering with verbose enabled", async () => {
    const projectDirectory = setupReactProject(tempDirectory, "verbose", {
      files: { "src/App.tsx": "export const App = () => <div />;\n" },
    });
    initGitRepo(projectDirectory, { commit: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const quietOptions = baseOptions();
    const firstResult = await inspect(projectDirectory, {
      lint: false,
      deadCode: false,
      noScore: true,
      silent: true,
    });
    const key = cacheKey(projectDirectory, quietOptions);
    expect(key).not.toBeNull();
    if (key === null) return;

    createScanResultCache(projectDirectory).store(key, {
      diagnostics: [diagnostic(projectDirectory)],
      score: firstResult.score,
      project: firstResult.project,
      userConfig: null,
      didLintFail: false,
      lintFailureReason: null,
      lintPartialFailures: [],
      didDeadCodeFail: false,
      deadCodeFailureReason: null,
      deadCodeOverlapped: false,
      directory: projectDirectory,
      scannedFileCount: firstResult.scannedFileCount ?? firstResult.project.sourceFileCount,
      scannedFilePaths: firstResult.scannedFilePaths ?? [],
      scanElapsedMilliseconds: firstResult.scanElapsedMilliseconds ?? 0,
      baselineDelta: undefined,
      lintFailureReasonKind: null,
      supplyChainOverlapTimedOut: false,
      suppressedRuleCounts: [],
    });

    const verboseResult = await inspect(projectDirectory, {
      lint: false,
      deadCode: false,
      noScore: true,
      silent: true,
      verbose: true,
    });

    expect(verboseResult.diagnostics).toEqual([diagnostic(projectDirectory)]);
  });
});
