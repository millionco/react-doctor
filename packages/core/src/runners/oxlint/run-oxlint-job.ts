import { buildOxlintChildEnv } from "../../utils/build-oxlint-child-env.js";
import {
  isOxlintJobTimelineEnabled,
  previewOxlintStdout,
  recordOxlintJobTimeline,
} from "../../utils/record-oxlint-job-timeline.js";
import { createOxlintWorkerPool, OxlintWorkerUnavailableError } from "./oxlint-worker-pool.js";
import type { OxlintWorkerPool } from "./oxlint-worker-pool.js";
import { resolveOxlintWorkerRuntime } from "./resolve-oxlint-worker-runtime.js";
import type { OxlintWorkerRuntime } from "./resolve-oxlint-worker-runtime.js";
import { spawnOxlint } from "./spawn-oxlint.js";

export interface RunOxlintJobInput {
  /** Node argv for one oxlint invocation: `[<oxlint bin>, ...cli args]`. */
  readonly argumentsList: string[];
  readonly rootDirectory: string;
  readonly nodeBinaryPath: string;
  readonly spawnTimeoutMs: number;
  readonly outputMaxBytes: number;
  readonly maxWorkers: number;
  readonly filesystemCacheEpoch: number | null;
  readonly abortSignal?: AbortSignal;
  readonly onStart?: () => void;
}

let cachedRuntime: OxlintWorkerRuntime | null | undefined;
const poolsByKey = new Map<string, OxlintWorkerPool>();

// One pool per process (per node binary + size) so every project of a
// monorepo scan shares the same warm workers.
const resolveSharedPool = (nodeBinaryPath: string, maxWorkers: number): OxlintWorkerPool | null => {
  if (cachedRuntime === undefined) cachedRuntime = resolveOxlintWorkerRuntime();
  if (cachedRuntime === null) return null;
  const poolKey = `${nodeBinaryPath}\u0000${maxWorkers}`;
  const existingPool = poolsByKey.get(poolKey);
  if (existingPool !== undefined) return existingPool;
  const pool = createOxlintWorkerPool({
    nodeBinaryPath,
    workerScriptPath: cachedRuntime.workerScriptPath,
    oxlintPackageDirectory: cachedRuntime.oxlintPackageDirectory,
    maxWorkers,
    environment: buildOxlintChildEnv(process.env),
  });
  poolsByKey.set(poolKey, pool);
  // Once the host's loop drains every worker is idle; reaping them here keeps
  // the CLI from leaving warm oxlint processes behind for the idle timeout.
  process.once("beforeExit", () => pool.closeIdleWorkers());
  return pool;
};

// Boots the shared pool ahead of the first batch so worker startup overlaps
// project discovery and config resolution instead of delaying the first job.
export const warmOxlintWorkerPool = (nodeBinaryPath: string, maxWorkers: number): void => {
  resolveSharedPool(nodeBinaryPath, maxWorkers)?.warm();
};

export const runOxlintJob = async (input: RunOxlintJobInput): Promise<string> => {
  const runLegacySpawn = (): Promise<string> =>
    spawnOxlint(
      input.argumentsList,
      input.rootDirectory,
      input.nodeBinaryPath,
      input.spawnTimeoutMs,
      input.outputMaxBytes,
      input.abortSignal,
      input.onStart,
    );
  const pool = resolveSharedPool(input.nodeBinaryPath, input.maxWorkers);
  if (pool === null || !pool.isAvailable()) return runLegacySpawn();
  let startedAt = Date.now();
  try {
    const stdout = await pool.run({
      argumentsList: input.argumentsList.slice(1),
      cwd: input.rootDirectory,
      timeoutMs: input.spawnTimeoutMs,
      outputMaxBytes: input.outputMaxBytes,
      filesystemCacheEpoch: input.filesystemCacheEpoch,
      abortSignal: input.abortSignal,
      onStart: () => {
        startedAt = Date.now();
        input.onStart?.();
      },
    });
    if (isOxlintJobTimelineEnabled) {
      recordOxlintJobTimeline({
        pid: null,
        startedAt,
        endedAt: Date.now(),
        args: input.argumentsList,
        exitCode: null,
        signal: null,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: 0,
        stdoutPreview: previewOxlintStdout(stdout),
      });
    }
    return stdout;
  } catch (error) {
    if (error instanceof OxlintWorkerUnavailableError) return runLegacySpawn();
    throw error;
  }
};
