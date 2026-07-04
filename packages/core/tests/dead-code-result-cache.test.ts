import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { ANALYZED_MANIFEST_FILENAMES, DEFAULT_EXTENSIONS } from "deslop-js/analyzed-inputs";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types/index.js";
import { checkDeadCode } from "../src/check-dead-code.js";
import { computeDeadCodeCacheKey } from "../src/dead-code/dead-code-result-cache.js";
import { DeadCodeResultCacheEnabled } from "../src/refs.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-dead-code-cache-"));
const originalCacheDirEnv = process.env["REACT_DOCTOR_CACHE_DIR"];

beforeAll(() => {
  // The cache resolves through `REACT_DOCTOR_CACHE_DIR` first; clear it so
  // every fixture's cache deterministically lands in its own
  // `node_modules/.cache/react-doctor` (created by `setupProject`).
  delete process.env["REACT_DOCTOR_CACHE_DIR"];
});

afterAll(() => {
  if (originalCacheDirEnv === undefined) delete process.env["REACT_DOCTOR_CACHE_DIR"];
  else process.env["REACT_DOCTOR_CACHE_DIR"] = originalCacheDirEnv;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (caseId: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  // An (empty) node_modules pins `resolveReactDoctorCacheDir` to the fixture
  // so the cache file is cleaned up with `tempRoot`.
  fs.mkdirSync(path.join(projectDirectory, "node_modules"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ name: caseId, type: "module", dependencies: { react: "^19.0.0" } }),
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  // Match `checkDeadCode`'s canonicalized root (os.tmpdir() is a symlink into
  // /private on macOS) so key inputs built from this path line up.
  return fs.realpathSync(projectDirectory);
};

const cacheFilePath = (projectDirectory: string): string =>
  path.join(projectDirectory, "node_modules", ".cache", "react-doctor", "dead-code-cache.json");

const keyInput = (projectDirectory: string) => ({
  rootDirectory: projectDirectory,
  entryPatterns: [],
  ignorePatterns: [],
  tsConfigPath: undefined,
  deslopJsModuleSpecifier: "deslop-js",
  coreVersion: "0.0.0",
});

interface SpyWorker {
  readonly factory: (input: unknown) => { result: Promise<unknown> };
  readonly callCount: () => number;
}

const createSpyWorker = (unusedFilePath: string): SpyWorker => {
  let calls = 0;
  return {
    factory: () => {
      calls += 1;
      return {
        result: Promise.resolve({
          unusedFiles: [{ path: unusedFilePath }],
          unusedExports: [],
          unusedDependencies: [],
          circularDependencies: [],
        }),
      };
    },
    callCount: () => calls,
  };
};

describe("computeDeadCodeCacheKey", () => {
  it("is stable for identical inputs", () => {
    const directory = setupProject("key-stable", {
      "src/index.ts": "export const used = 1;\n",
    });
    expect(computeDeadCodeCacheKey(keyInput(directory))).toBe(
      computeDeadCodeCacheKey(keyInput(directory)),
    );
  });

  it("changes when a source file is touched (mtime)", () => {
    const directory = setupProject("key-touch", {
      "src/index.ts": "export const used = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(directory, "src", "index.ts"), later, later);
    expect(computeDeadCodeCacheKey(keyInput(directory))).not.toBe(keyBefore);
  });

  it("changes when a source file is added", () => {
    const directory = setupProject("key-add", {
      "src/index.ts": "export const used = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    fs.writeFileSync(path.join(directory, "src", "added.ts"), "export const added = 1;\n");
    expect(computeDeadCodeCacheKey(keyInput(directory))).not.toBe(keyBefore);
  });

  it("changes when a source file is deleted", () => {
    const directory = setupProject("key-delete", {
      "src/index.ts": "export const used = 1;\n",
      "src/doomed.ts": "export const doomed = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    fs.rmSync(path.join(directory, "src", "doomed.ts"));
    expect(computeDeadCodeCacheKey(keyInput(directory))).not.toBe(keyBefore);
  });

  it("changes when a manifest (package.json) changes", () => {
    const directory = setupProject("key-manifest", {
      "src/index.ts": "export const used = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "key-manifest",
        type: "module",
        dependencies: { react: "^19.0.0", "left-pad": "^1.0.0" },
      }),
    );
    expect(computeDeadCodeCacheKey(keyInput(directory))).not.toBe(keyBefore);
  });

  it("changes with entry / ignore patterns and the resolved tsconfig", () => {
    const directory = setupProject("key-config", {
      "src/index.ts": "export const used = 1;\n",
    });
    const baseKey = computeDeadCodeCacheKey(keyInput(directory));
    expect(
      computeDeadCodeCacheKey({ ...keyInput(directory), entryPatterns: ["src/cli.ts"] }),
    ).not.toBe(baseKey);
    expect(
      computeDeadCodeCacheKey({ ...keyInput(directory), ignorePatterns: ["src/generated/**"] }),
    ).not.toBe(baseKey);
    expect(
      computeDeadCodeCacheKey({
        ...keyInput(directory),
        tsConfigPath: path.join(directory, "tsconfig.json"),
      }),
    ).not.toBe(baseKey);
  });

  it("ignores files the analysis never reads (scratch text files)", () => {
    const directory = setupProject("key-scratch", {
      "src/index.ts": "export const used = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    fs.writeFileSync(path.join(directory, "scratch.txt"), "not part of the graph\n");
    expect(computeDeadCodeCacheKey(keyInput(directory))).toBe(keyBefore);
  });

  it("changes when the core package version changes", () => {
    const directory = setupProject("key-core-version", {
      "src/index.ts": "export const used = 1;\n",
    });
    expect(computeDeadCodeCacheKey({ ...keyInput(directory), coreVersion: "99.0.0" })).not.toBe(
      computeDeadCodeCacheKey(keyInput(directory)),
    );
  });
});

describe("fingerprinted file sets (imported from deslop-js/analyzed-inputs)", () => {
  it("fingerprints a file for every extension deslop's walk parses", () => {
    const directory = setupProject("key-extension-coverage", {
      "src/index.ts": "export const used = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    for (const extension of DEFAULT_EXTENSIONS) {
      const probePath = path.join(directory, "probe", `probe${extension}`);
      fs.mkdirSync(path.dirname(probePath), { recursive: true });
      fs.writeFileSync(probePath, "probe\n");
      expect(computeDeadCodeCacheKey(keyInput(directory)), extension).not.toBe(keyBefore);
      fs.rmSync(probePath);
    }
  });

  it("fingerprints every manifest name deslop's analysis reads", () => {
    const directory = setupProject("key-manifest-coverage", {
      "src/index.ts": "export const used = 1;\n",
    });
    const keyBefore = computeDeadCodeCacheKey(keyInput(directory));
    for (const manifestName of ANALYZED_MANIFEST_FILENAMES) {
      const probePath = path.join(directory, "probe", manifestName);
      fs.mkdirSync(path.dirname(probePath), { recursive: true });
      fs.writeFileSync(probePath, "probe\n");
      expect(computeDeadCodeCacheKey(keyInput(directory)), manifestName).not.toBe(keyBefore);
      fs.rmSync(probePath);
    }
  });

  // Not a redundant copy: a NEW extension or manifest in a deslop-js upgrade
  // widens what the cache fingerprints, so it must land here as a conscious,
  // reviewed choice rather than silently.
  it("matches the reviewed set snapshots", () => {
    expect([...DEFAULT_EXTENSIONS].sort()).toEqual([
      ".astro",
      ".cjs",
      ".css",
      ".cts",
      ".gql",
      ".graphql",
      ".js",
      ".jsx",
      ".mdx",
      ".mjs",
      ".mts",
      ".scss",
      ".svelte",
      ".ts",
      ".tsx",
      ".vue",
    ]);
    expect([...ANALYZED_MANIFEST_FILENAMES].sort()).toEqual([
      ".gitignore",
      "app.json",
      "bun.lock",
      "bun.lockb",
      "lerna.json",
      "ng-package.json",
      "nx.json",
      "package-lock.json",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "pnpm-workspace.yml",
      "rush.json",
      "turbo.json",
      "yarn.lock",
    ]);
  });
});

describe("checkDeadCode result cache", () => {
  it("replays a stored pass without spawning the worker, and reports the outcome", async () => {
    const directory = setupProject("hit-skips-analysis", {
      "src/index.ts": "export const used = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
    });
    const spyWorker = createSpyWorker(path.join(directory, "src", "orphan.ts"));
    const cacheOutcomes: boolean[] = [];
    const onCacheOutcome = (didHitCache: boolean): void => {
      cacheOutcomes.push(didHitCache);
    };

    const firstRun = await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: true,
      onCacheOutcome,
    });
    expect(spyWorker.callCount()).toBe(1);
    expect(cacheOutcomes).toEqual([false]);
    expect(fs.existsSync(cacheFilePath(directory))).toBe(true);

    const secondRun = await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: true,
      onCacheOutcome,
    });
    expect(spyWorker.callCount()).toBe(1);
    expect(cacheOutcomes).toEqual([false, true]);
    expect(secondRun).toEqual(firstRun);
  });

  it("misses after a source file changes, and re-analyzes", async () => {
    const directory = setupProject("miss-on-change", {
      "src/index.ts": "export const used = 1;\n",
    });
    const spyWorker = createSpyWorker(path.join(directory, "src", "index.ts"));
    const cacheOutcomes: boolean[] = [];
    const onCacheOutcome = (didHitCache: boolean): void => {
      cacheOutcomes.push(didHitCache);
    };

    await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: true,
      onCacheOutcome,
    });
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(directory, "src", "index.ts"), later, later);
    await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: true,
      onCacheOutcome,
    });
    expect(spyWorker.callCount()).toBe(2);
    expect(cacheOutcomes).toEqual([false, false]);
  });

  it("never stores a failed pass", async () => {
    const directory = setupProject("store-barred-on-failure", {
      "src/index.ts": "export const used = 1;\n",
    });
    await expect(
      checkDeadCode({
        rootDirectory: directory,
        createWorker: () => ({ result: Promise.reject(new Error("analysis crashed")) }),
        cacheEnabled: true,
      }),
    ).rejects.toThrow("analysis crashed");
    expect(fs.existsSync(cacheFilePath(directory))).toBe(false);

    // The next (successful) run must be a genuine miss that re-analyzes.
    const spyWorker = createSpyWorker(path.join(directory, "src", "index.ts"));
    const cacheOutcomes: boolean[] = [];
    await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: true,
      onCacheOutcome: (didHitCache) => {
        cacheOutcomes.push(didHitCache);
      },
    });
    expect(spyWorker.callCount()).toBe(1);
    expect(cacheOutcomes).toEqual([false]);
  });

  it("bypasses the cache entirely when disabled (default)", async () => {
    const directory = setupProject("cache-disabled", {
      "src/index.ts": "export const used = 1;\n",
    });
    const spyWorker = createSpyWorker(path.join(directory, "src", "index.ts"));
    const cacheOutcomes: boolean[] = [];
    const runOnce = (): Promise<Diagnostic[]> =>
      checkDeadCode({
        rootDirectory: directory,
        createWorker: spyWorker.factory,
        onCacheOutcome: (didHitCache) => {
          cacheOutcomes.push(didHitCache);
        },
      });

    await runOnce();
    await runOnce();
    expect(spyWorker.callCount()).toBe(2);
    expect(cacheOutcomes).toEqual([]);
    expect(fs.existsSync(cacheFilePath(directory))).toBe(false);
  });

  it("ignores an existing stored entry when the cache is disabled", async () => {
    const directory = setupProject("cache-disabled-after-store", {
      "src/index.ts": "export const used = 1;\n",
    });
    const spyWorker = createSpyWorker(path.join(directory, "src", "index.ts"));
    await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: true,
    });
    expect(fs.existsSync(cacheFilePath(directory))).toBe(true);

    await checkDeadCode({
      rootDirectory: directory,
      createWorker: spyWorker.factory,
      cacheEnabled: false,
    });
    expect(spyWorker.callCount()).toBe(2);
  });

  it("threads deslop's incremental cache path into the worker when caching is enabled", async () => {
    const directory = setupProject("incremental-path-threaded", {
      "src/index.ts": "export const used = 1;\n",
    });
    let capturedInput: { incrementalCachePath?: string } | null = null;
    await checkDeadCode({
      rootDirectory: directory,
      cacheEnabled: true,
      createWorker: (input) => {
        capturedInput = input;
        return {
          result: Promise.resolve({
            unusedFiles: [],
            unusedExports: [],
            unusedDependencies: [],
            circularDependencies: [],
          }),
        };
      },
    });
    // Same per-project cache directory as the whole-result cache, distinct file.
    expect(capturedInput?.incrementalCachePath).toBe(
      path.join(directory, "node_modules", ".cache", "react-doctor", "dead-code-summaries.json"),
    );
  });

  it("reports the worker's summary-cache stats through onSummaryCacheStats", async () => {
    const directory = setupProject("summary-stats-reported", {
      "src/index.ts": "export const used = 1;\n",
    });
    let reportedStats: { hits: number; misses: number } | null = null;
    await checkDeadCode({
      rootDirectory: directory,
      cacheEnabled: true,
      onSummaryCacheStats: (stats) => {
        reportedStats = stats;
      },
      createWorker: () => ({
        result: Promise.resolve({
          unusedFiles: [],
          unusedExports: [],
          unusedDependencies: [],
          circularDependencies: [],
          summaryCacheStats: { hits: 41, misses: 2 },
        }),
      }),
    });
    expect(reportedStats).toEqual({ hits: 41, misses: 2 });
  });

  it("leaves onSummaryCacheStats uninvoked when the worker reports no stats", async () => {
    const directory = setupProject("summary-stats-absent", {
      "src/index.ts": "export const used = 1;\n",
    });
    let didReportStats = false;
    await checkDeadCode({
      rootDirectory: directory,
      onSummaryCacheStats: () => {
        didReportStats = true;
      },
      createWorker: () => ({
        result: Promise.resolve({
          unusedFiles: [],
          unusedExports: [],
          unusedDependencies: [],
          circularDependencies: [],
        }),
      }),
    });
    expect(didReportStats).toBe(false);
  });

  it("omits deslop's incremental cache path when caching is off (default)", async () => {
    const directory = setupProject("incremental-path-omitted", {
      "src/index.ts": "export const used = 1;\n",
    });
    let capturedInput: { incrementalCachePath?: string } | null = null;
    await checkDeadCode({
      rootDirectory: directory,
      createWorker: (input) => {
        capturedInput = input;
        return {
          result: Promise.resolve({
            unusedFiles: [],
            unusedExports: [],
            unusedDependencies: [],
            circularDependencies: [],
          }),
        };
      },
    });
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.incrementalCachePath).toBeUndefined();
  });
});

describe("DeadCodeResultCacheEnabled", () => {
  // One read only: a Reference's `defaultValue` is memoized per process, so
  // this test owns the file's single unprovided read of the ref.
  it("defaults off when REACT_DOCTOR_NO_CACHE is set", () => {
    const originalNoCacheEnv = process.env["REACT_DOCTOR_NO_CACHE"];
    process.env["REACT_DOCTOR_NO_CACHE"] = "1";
    try {
      const enabled = Effect.runSync(
        Effect.gen(function* () {
          return yield* DeadCodeResultCacheEnabled;
        }),
      );
      expect(enabled).toBe(false);
    } finally {
      if (originalNoCacheEnv === undefined) delete process.env["REACT_DOCTOR_NO_CACHE"];
      else process.env["REACT_DOCTOR_NO_CACHE"] = originalNoCacheEnv;
    }
  });
});
