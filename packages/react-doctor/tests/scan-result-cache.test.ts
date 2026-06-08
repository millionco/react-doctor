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
  type CachedScanPayload,
} from "../src/cli/utils/scan-result-cache.js";
import { VERSION } from "../src/cli/utils/version.js";
import { commitAll, initGitRepo, setupReactProject } from "./regressions/_helpers.js";

let tempDirectory: string;

const baseOptions = (overrides: Partial<ResolvedInspectOptions> = {}): ResolvedInspectOptions => ({
  lint: false,
  deadCode: false,
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

    const payload: CachedScanPayload = {
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
      directory: projectDirectory,
      scannedFileCount: 1,
      scannedFilePaths: [],
      scanElapsedMilliseconds: 1,
      baselineDelta: undefined,
      lintFailureReasonKind: null,
    };
    const cache = createScanResultCache(projectDirectory);
    cache.store(key, payload);

    expect(cache.lookup(key)?.diagnostics).toEqual([diagnostic(projectDirectory)]);
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
    const alternateNodeBinaryPath = path.join(tempDirectory, "fake-node");
    fs.writeFileSync(alternateNodeBinaryPath, "node-a");
    expect(cacheKey(projectDirectory, options, VERSION, alternateNodeBinaryPath)).not.toBe(
      originalKey,
    );

    fs.writeFileSync(
      path.join(projectDirectory, "doctor.config.json"),
      JSON.stringify({ rules: {} }),
    );
    expect(cacheKey(projectDirectory, options)).toBeNull();

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
      directory: projectDirectory,
      scannedFileCount: firstResult.scannedFileCount ?? firstResult.project.sourceFileCount,
      scannedFilePaths: firstResult.scannedFilePaths ?? [],
      scanElapsedMilliseconds: firstResult.scanElapsedMilliseconds ?? 0,
      baselineDelta: undefined,
      lintFailureReasonKind: null,
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
