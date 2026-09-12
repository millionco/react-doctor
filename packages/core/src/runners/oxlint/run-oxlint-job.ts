import { buildOxlintChildEnv } from "../../utils/build-oxlint-child-env.js";
import {
  isOxlintJobTimelineEnabled,
  previewOxlintStdout,
  recordOxlintJobTimeline,
} from "../../utils/record-oxlint-job-timeline.js";
import type { OxlintWorkerProbeResult } from "../../start-oxlint-worker.js";
import { isRecord } from "../../utils/is-record.js";
import { createOxlintWorkerPool, OxlintWorkerUnavailableError } from "./oxlint-worker-pool.js";
import type { OxlintWorkerPool, OxlintWorkerProbeRequest } from "./oxlint-worker-pool.js";
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

// Stands in for the oxlint binary slot of a probe job's timeline `args`, so
// the harness can tell probe jobs from lint jobs.
const PROBE_JOB_TIMELINE_MARKER = "<sidecar-probes>";

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
    pluginPath: cachedRuntime.pluginPath,
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

// Whether lint jobs will run on warm pool workers rather than per-batch
// spawns, so the batch planner can split work for the pool's idle workers.
export const isOxlintWorkerPoolAvailable = (nodeBinaryPath: string, maxWorkers: number): boolean =>
  resolveSharedPool(nodeBinaryPath, maxWorkers)?.isAvailable() ?? false;

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

export interface RunOxlintProbeJobInput {
  readonly rootDirectory: string;
  readonly probeRequest: OxlintWorkerProbeRequest;
  readonly nodeBinaryPath: string;
  readonly spawnTimeoutMs: number;
  readonly outputMaxBytes: number;
  readonly maxWorkers: number;
  readonly filesystemCacheEpoch: number | null;
  readonly abortSignal?: AbortSignal;
}

const isProbeResult = (value: unknown): value is OxlintWorkerProbeResult =>
  isRecord(value) &&
  Array.isArray(value.paths) &&
  value.paths.every((entry) => typeof entry === "string") &&
  Array.isArray(value.existenceAnswers) &&
  value.existenceAnswers.length === value.paths.length &&
  value.existenceAnswers.every((entry) => entry === null || typeof entry === "string") &&
  Array.isArray(value.traces);

/**
 * Collects sidecar dependency probes for a batch of files on a warm pool
 * worker. Returns `null` when no pool is available (the caller collects
 * in-process); throws when the worker job fails, which the caller also folds
 * into the in-process fallback for that batch.
 */
export const runOxlintProbeJob = async (
  input: RunOxlintProbeJobInput,
): Promise<OxlintWorkerProbeResult | null> => {
  const pool = resolveSharedPool(input.nodeBinaryPath, input.maxWorkers);
  if (pool === null || !pool.isAvailable()) return null;
  let startedAt = Date.now();
  const stdout = await pool.run({
    argumentsList: [],
    probeRequest: input.probeRequest,
    cwd: input.rootDirectory,
    timeoutMs: input.spawnTimeoutMs,
    outputMaxBytes: input.outputMaxBytes,
    filesystemCacheEpoch: input.filesystemCacheEpoch,
    abortSignal: input.abortSignal,
    onStart: () => {
      startedAt = Date.now();
    },
  });
  if (isOxlintJobTimelineEnabled) {
    recordOxlintJobTimeline({
      pid: null,
      startedAt,
      endedAt: Date.now(),
      args: [PROBE_JOB_TIMELINE_MARKER, ...input.probeRequest.files],
      exitCode: null,
      signal: null,
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: 0,
      stdoutPreview: previewOxlintStdout(stdout),
    });
  }
  const parsed: unknown = JSON.parse(stdout);
  if (!isProbeResult(parsed) || parsed.traces.length !== input.probeRequest.files.length) {
    throw new Error("oxlint worker returned a malformed probe result");
  }
  return parsed;
};
