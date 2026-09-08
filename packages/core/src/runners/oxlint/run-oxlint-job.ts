import { MIN_OXLINT_WORKER_THREADS } from "../../constants.js";
import { buildOxlintChildEnv } from "../../utils/build-oxlint-child-env.js";
import { readSystemConcurrencyFacts } from "../../utils/read-system-concurrency-facts.js";
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
  readonly abortSignal?: AbortSignal;
  readonly onStart?: () => void;
}

let cachedRuntime: OxlintWorkerRuntime | null | undefined;
const poolsByKey = new Map<string, OxlintWorkerPool>();

// Every warm worker keeps its own Rust thread pool alive, so N workers at
// oxlint's default (one thread per core) oversubscribe the box N-fold; split
// the cores across the pool instead.
const resolveThreadsPerWorker = (maxWorkers: number): number =>
  Math.max(
    MIN_OXLINT_WORKER_THREADS,
    Math.floor(readSystemConcurrencyFacts().availableCores / maxWorkers),
  );

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
  try {
    return await pool.run({
      argumentsList: [
        "--threads",
        String(resolveThreadsPerWorker(input.maxWorkers)),
        ...input.argumentsList.slice(1),
      ],
      cwd: input.rootDirectory,
      timeoutMs: input.spawnTimeoutMs,
      outputMaxBytes: input.outputMaxBytes,
      abortSignal: input.abortSignal,
      onStart: input.onStart,
    });
  } catch (error) {
    if (error instanceof OxlintWorkerUnavailableError) return runLegacySpawn();
    throw error;
  }
};
