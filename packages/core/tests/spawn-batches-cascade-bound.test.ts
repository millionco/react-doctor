/**
 * Covers the binary-split cascade bound in `spawnLintBatches`: a batch whose
 * every spawn fails with a splittable error must NOT recurse without limit.
 * The cumulative split-time budget and the recursion-depth cap each drop the
 * remaining files via `onPartialFailure` instead of re-waiting a full spawn
 * timeout at every level (the `Linter.run` 7.5h-tail fix).
 *
 * Mocks `node:child_process.spawn` with a fake child that always exits on a
 * kill signal → `OxlintBatchExceeded { kind: "killed" }`, which is splittable.
 * Isolated in its own file so the real-spawn suites keep the genuine binary.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV } from "../src/constants.js";

interface SpawnMockState {
  callCount: number;
  killCount: number;
  // When false, the fake child stays in-flight (no auto-close) so an abort
  // test can observe the teardown rather than a self-resolving exit.
  autoClose: boolean;
  completeSpawn?: (child: SpawnMockChild, argumentsList: ReadonlyArray<string>) => void;
}

interface SpawnMockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

const spawnState = vi.hoisted(
  (): SpawnMockState => ({
    callCount: 0,
    killCount: 0,
    autoClose: true,
  }),
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  // By default every spawn exits on a kill signal, which `spawnOxlint` maps to
  // a splittable `OxlintBatchExceeded { kind: "killed" }` — deterministic and
  // timer-free, so the cascade bound is exercised without real waits.
  const spawn = (_command: string, argumentsList: ReadonlyArray<string>) => {
    spawnState.callCount += 1;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {
        spawnState.killCount += 1;
      },
    });
    // Defer past the synchronous listener attachment in `spawnOxlint`.
    queueMicrotask(() => {
      if (spawnState.completeSpawn) {
        spawnState.completeSpawn(child, argumentsList);
        return;
      }
      if (spawnState.autoClose) child.emit("close", null, "SIGKILL");
    });
    return child;
  };
  return { ...actual, spawn };
});

import { spawnLintBatches } from "../src/runners/oxlint/spawn-batches.js";

const project: ProjectInfo = {
  rootDirectory: "/tmp/app",
  projectName: "app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
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
  sourceFileCount: 6,
};

const FILE_COUNT = 100;
const singleLargeBatch = (): string[][] => [
  Array.from({ length: FILE_COUNT }, (_unused, index) => `src/file-${index}.tsx`),
];

const NATIVE_BATCH_FILE_COUNT = 500;
const RECOVERY_TEST_OUTPUT_MAX_BYTES = 100_000;

const mockLargeBatchWithOffender = (
  failureKind: "output-too-large" | "oom",
  shouldRecoverOnRescue = false,
) => {
  const files = Array.from(
    { length: NATIVE_BATCH_FILE_COUNT },
    (_unused, index) => `src/native-file-${index}.tsx`,
  );
  const offenderFile = files[0];
  const attemptedBatches: string[][] = [];
  let offenderSingleFileAttempts = 0;
  spawnState.completeSpawn = (child, argumentsList) => {
    const batch = argumentsList.filter((argument) => argument.endsWith(".tsx"));
    attemptedBatches.push(batch);
    if (batch.includes(offenderFile)) {
      if (batch.length === 1) offenderSingleFileAttempts += 1;
      if (!shouldRecoverOnRescue || batch.length > 1 || offenderSingleFileAttempts === 1) {
        if (failureKind === "output-too-large") {
          child.stdout.emit("data", Buffer.alloc(RECOVERY_TEST_OUTPUT_MAX_BYTES + 1));
          child.emit("close", null, "SIGKILL");
        } else {
          child.emit("close", null, "SIGABRT");
        }
        return;
      }
    }
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          diagnostics: batch.map((filename) => ({
            filename,
            message: "Array index used as a key",
            code: "react-doctor-native(no-array-index-as-key)",
            severity: "warning",
            labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
          })),
          number_of_files: batch.length,
          number_of_rules: 1,
        }),
      ),
    );
    child.emit("close", 0, null);
  };
  return { files, offenderFile, attemptedBatches };
};

beforeEach(() => {
  spawnState.callCount = 0;
  spawnState.killCount = 0;
  spawnState.autoClose = true;
  spawnState.completeSpawn = undefined;
});

describe("spawnLintBatches binary-split cascade bound", () => {
  it.each<"output-too-large" | "oom">(["output-too-large", "oom"])(
    "preserves all 499 healthy files when a 500-file batch contains one persistent %s offender",
    async (failureKind) => {
      const { files, offenderFile, attemptedBatches } = mockLargeBatchWithOffender(failureKind);
      const partialFailures: string[] = [];
      const onAnalyzedFiles = vi.fn();
      const diagnostics = await spawnLintBatches({
        baseArgs: ["--stub", "--threads", "1"],
        fileBatches: [files],
        rootDirectory: process.cwd(),
        nodeBinaryPath: process.execPath,
        project,
        concurrency: 2,
        outputMaxBytes: RECOVERY_TEST_OUTPUT_MAX_BYTES,
        onPartialFailure: (reason) => partialFailures.push(reason),
        onAnalyzedFiles,
      });

      expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual(
        files.slice(1).sort(),
      );
      expect(onAnalyzedFiles).toHaveBeenCalledExactlyOnceWith(files.slice(1).sort());
      expect(partialFailures).toHaveLength(1);
      expect(partialFailures[0]).toContain(
        `1 file(s) failed to lint and were skipped (${offenderFile})`,
      );
      expect(partialFailures[0]).toContain(
        failureKind === "oom" ? "ran out of memory" : "output exceeded limit",
      );
      expect(attemptedBatches[0]).toEqual(files);
      expect(attemptedBatches).toContainEqual(files.slice(0, 2));
      expect(
        attemptedBatches.filter((batch) => batch.length === 1 && batch[0] === offenderFile),
      ).toHaveLength(failureKind === "oom" ? 2 : 1);
      if (failureKind === "output-too-large") expect(spawnState.killCount).toBeGreaterThan(0);
    },
  );

  it("restores complete coverage when the isolated offender succeeds during serial OOM rescue", async () => {
    const { files, offenderFile, attemptedBatches } = mockLargeBatchWithOffender("oom", true);
    const onPartialFailure = vi.fn();
    const onAnalyzedFiles = vi.fn();
    const diagnostics = await spawnLintBatches({
      baseArgs: ["--stub", "--threads", "1"],
      fileBatches: [files],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      concurrency: 2,
      onPartialFailure,
      onAnalyzedFiles,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual([...files].sort());
    expect(onAnalyzedFiles).toHaveBeenCalledExactlyOnceWith([...files].sort());
    expect(onPartialFailure).not.toHaveBeenCalled();
    expect(attemptedBatches.at(-1)).toEqual([offenderFile]);
    expect(
      attemptedBatches.filter((batch) => batch.length === 1 && batch[0] === offenderFile),
    ).toHaveLength(2);
  });

  it.each<"output-too-large" | "oom">(["output-too-large", "oom"])(
    "rejects an isolated %s offender in a 500-file batch when native Oxlint is required",
    async (failureKind) => {
      const { files, offenderFile, attemptedBatches } = mockLargeBatchWithOffender(failureKind);
      const previousRequiredValue = process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
      const onPartialFailure = vi.fn();
      const onAnalyzedFiles = vi.fn();
      process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = "1";
      try {
        await expect(
          spawnLintBatches({
            baseArgs: ["--stub", "--threads", "1"],
            fileBatches: [files],
            rootDirectory: process.cwd(),
            nodeBinaryPath: process.execPath,
            project,
            concurrency: 2,
            outputMaxBytes: RECOVERY_TEST_OUTPUT_MAX_BYTES,
            onPartialFailure,
            onAnalyzedFiles,
          }),
        ).rejects.toMatchObject({
          message: "The required native Oxlint batch failed.",
          cause: { reason: { kind: failureKind } },
        });
      } finally {
        if (previousRequiredValue === undefined) {
          delete process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
        } else {
          process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = previousRequiredValue;
        }
      }
      expect(attemptedBatches).toContainEqual(files.slice(0, 2));
      expect(attemptedBatches.at(-1)).toEqual([offenderFile]);
      expect(
        attemptedBatches.filter((batch) => batch.length === 1 && batch[0] === offenderFile),
      ).toHaveLength(1);
      expect(onPartialFailure).not.toHaveBeenCalled();
      expect(onAnalyzedFiles).not.toHaveBeenCalled();
    },
  );

  it("propagates a terminal single-file failure when native Oxlint is required", async () => {
    const previousRequiredValue = process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
    process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = "1";
    try {
      await expect(
        spawnLintBatches({
          baseArgs: ["--stub"],
          fileBatches: [["src/failing.tsx"]],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
          project,
        }),
      ).rejects.toThrow("The required native Oxlint batch failed.");
    } finally {
      if (previousRequiredValue === undefined) {
        delete process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
      } else {
        process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = previousRequiredValue;
      }
    }
    expect(spawnState.callCount).toBe(1);
  });

  it("drops the whole batch after one spawn when the cumulative split budget is exhausted", async () => {
    const partialFailures: string[] = [];
    const diagnostics = await spawnLintBatches({
      baseArgs: ["--stub"],
      fileBatches: singleLargeBatch(),
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      onPartialFailure: (reason) => partialFailures.push(reason),
      // Budget already elapsed → the first splittable failure drops the
      // batch instead of recursing into more full-timeout waits.
      splitTotalBudgetMs: 0,
    });

    expect(diagnostics).toEqual([]);
    // No binary-split recursion at all: one spawn, then the budget short-circuits.
    expect(spawnState.callCount).toBe(1);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain(`${FILE_COUNT} file(s) failed to lint`);
    expect(partialFailures[0]).toContain("split budget");
  });

  it("bounds recursion at the depth cap rather than splitting down to single files", async () => {
    const partialFailures: string[] = [];
    const splitMaxDepth = 3;
    const diagnostics = await spawnLintBatches({
      baseArgs: ["--stub"],
      fileBatches: singleLargeBatch(),
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      onPartialFailure: (reason) => partialFailures.push(reason),
      splitMaxDepth,
      // Large budget so the depth cap is the binding constraint.
      splitTotalBudgetMs: 600_000,
    });

    expect(diagnostics).toEqual([]);
    // A truncated binary tree spawns at most sum(2^d, d=0..depth) <= 2^(depth+1)
    // times. Without the cap this 100-file batch would split ~7 levels to single
    // files, and every re-timeout would wait a full spawn budget.
    expect(spawnState.callCount).toBeGreaterThan(1);
    expect(spawnState.callCount).toBeLessThanOrEqual(2 ** (splitMaxDepth + 1));
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("split depth cap");
  });

  it("anchors the split budget per top-level batch, so one exhausted batch cannot starve a later batch of split attempts", async () => {
    // Virtual clock: every spawn "takes" 10s, so a 5s budget is exhausted by
    // the time any split retry lands — each top-level batch gets exactly one
    // depth-0 spawn plus two depth-1 half spawns. Under the regressed
    // (pass-wide) anchoring, the SECOND batch would see the first batch's
    // elapsed deadline and be dropped whole after a single spawn (4 total
    // spawns instead of 6).
    const virtualSpawnCostMs = 10_000;
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => spawnState.callCount * virtualSpawnCostMs);
    try {
      const partialFailures: string[] = [];
      const diagnostics = await spawnLintBatches({
        baseArgs: ["--stub"],
        fileBatches: [
          Array.from({ length: 4 }, (_unused, index) => `src/first-${index}.tsx`),
          Array.from({ length: 4 }, (_unused, index) => `src/second-${index}.tsx`),
        ],
        rootDirectory: process.cwd(),
        nodeBinaryPath: process.execPath,
        project,
        onPartialFailure: (reason) => partialFailures.push(reason),
        splitTotalBudgetMs: 5_000,
        splitMaxDepth: 8,
      });

      expect(diagnostics).toEqual([]);
      expect(spawnState.callCount).toBe(6);
      expect(partialFailures).toHaveLength(1);
      expect(partialFailures[0]).toContain("8 file(s) failed to lint");
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});

describe("spawnLintBatches abort teardown", () => {
  const runWithSignal = (signal: AbortSignal) =>
    spawnLintBatches({
      baseArgs: ["--stub"],
      fileBatches: singleLargeBatch(),
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      signal,
    });

  it("spawns nothing once the abort signal is already set", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(runWithSignal(abortController.signal)).rejects.toThrow();
    // Pre-spawn short-circuit: no oxlint subprocess is started after abort,
    // so the lint phase can't keep burning work in the background.
    expect(spawnState.callCount).toBe(0);
  });

  it("SIGKILLs the in-flight oxlint child when the signal aborts mid-run", async () => {
    spawnState.autoClose = false;
    const abortController = new AbortController();
    const pending = runWithSignal(abortController.signal);

    while (spawnState.callCount === 0) await Promise.resolve();
    abortController.abort();

    await expect(pending).rejects.toThrow();
    expect(spawnState.killCount).toBeGreaterThan(0);
  });
});
