import {
  OXLINT_MAX_FILES_PER_BATCH,
  OXLINT_POOLED_BATCHES_PER_WORKER,
  OXLINT_POOLED_MIN_FILES_PER_BATCH,
  SPAWN_ARGS_MAX_LENGTH_CHARS,
} from "../constants.js";
import { estimateArgsLength } from "./estimate-args-length.js";

export interface PlanLintBatchesInput {
  readonly baseArgs: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
  /**
   * Byte size per file (the discovery walk's existing stat). Drives the LPT
   * assignment; a file missing from the map weighs zero, matching
   * `listSourceFilesWithSize`'s stat-failure fallback.
   */
  readonly sizeByFile: ReadonlyMap<string, number>;
  /**
   * Warm pool workers the batches will run on. When set, the plan opens
   * enough batches to keep every worker busy (see `resolvePooledBatchCount`);
   * omitted for the per-batch spawn path, which keeps the mandatory count.
   */
  readonly pooledWorkerCount?: number;
}

interface MutableLintBatch {
  fileIndexes: number[];
  totalSizeBytes: number;
  argsLengthChars: number;
}

// Batches a warm worker pool should run: `OXLINT_POOLED_BATCHES_PER_WORKER`
// per worker so the pool has a second wave to absorb per-file cost skew, never
// so many that a batch drops under `OXLINT_POOLED_MIN_FILES_PER_BATCH` files.
export const resolvePooledBatchCount = (fileCount: number, pooledWorkerCount: number): number =>
  Math.max(
    1,
    Math.min(
      pooledWorkerCount * OXLINT_POOLED_BATCHES_PER_WORKER,
      Math.floor(fileCount / OXLINT_POOLED_MIN_FILES_PER_BATCH),
    ),
  );

/**
 * Balanced LPT (longest-processing-time-first) lint batch planner. Where
 * `batchIncludePaths` greedily fills fixed-size batches and leaves a small
 * remainder batch, so the parallel pool's wall clock is set by whichever
 * full chunk happened to collect the most work while
 * the remainder's worker idles), this planner keeps the mandatory batch
 * count — `ceil(files / OXLINT_MAX_FILES_PER_BATCH)`, the JS-plugin
 * perf-cliff / native-binding SIGABRT guard — and assigns files largest-first,
 * each to the least-loaded batch by cumulative byte size. Every batch ends up
 * with an even share of files AND bytes, so no batch is a straggler; heavy
 * files are SPREAD across batches (the documented precondition for `cost`
 * ordering to beat `arrival`) instead of concentrated in one.
 *
 * The per-batch spawn path is deliberately NOT worker-count-aware: splitting
 * into extra batches to feed idle workers was measured (619-file corpus, 10
 * cores) to REGRESS the lint wall — each additional concurrent subprocess pays
 * a contended cold start (node boot + plugin import + native dlopen, ~180 ms
 * uncontended and 2-3× that in a full wave) that outweighs the smaller
 * per-batch file share. A warm worker pool has no such cost, so when
 * `pooledWorkerCount` is given the plan is raised to `resolvePooledBatchCount`
 * — a 1,000-file scan on 10 workers otherwise ran as 5 batches on 5 workers
 * while the other 5 idled.
 *
 * Every batch also respects the spawn-args char budget; a file that fits no
 * existing batch opens a new one, mirroring `batchIncludePaths`. Within a
 * batch, files return in arrival order, and the assignment is fully
 * deterministic (ties broken by lowest batch index), so a plan is
 * reproducible for a fixed (files, sizes) input. Batch composition cannot
 * change diagnostics — rules that look beyond one file (`CROSS_FILE_RULE_IDS`)
 * read the OTHER files via the filesystem, never via batch-mates — so the
 * plan only moves wall-clock time.
 *
 * O(files × batches); the linear least-loaded scan is fine at real-world
 * scale (a 3,500-file monorepo is 36 batches ≈ 126k comparisons).
 */
export const planLintBatches = ({
  baseArgs,
  files,
  sizeByFile,
  pooledWorkerCount,
}: PlanLintBatchesInput): string[][] => {
  if (files.length === 0) return [];
  const mandatoryBatchCount = Math.ceil(files.length / OXLINT_MAX_FILES_PER_BATCH);
  const batchCount =
    pooledWorkerCount === undefined
      ? mandatoryBatchCount
      : Math.max(mandatoryBatchCount, resolvePooledBatchCount(files.length, pooledWorkerCount));
  const maxFilesPerBatch = Math.ceil(files.length / batchCount);
  const baseArgsLengthChars = estimateArgsLength(baseArgs);

  const descendingSizeIndexes = [...files.keys()].sort(
    (leftIndex, rightIndex) =>
      (sizeByFile.get(files[rightIndex]) ?? 0) - (sizeByFile.get(files[leftIndex]) ?? 0),
  );

  const batches: MutableLintBatch[] = Array.from({ length: batchCount }, () => ({
    fileIndexes: [],
    totalSizeBytes: 0,
    argsLengthChars: baseArgsLengthChars,
  }));

  for (const fileIndex of descendingSizeIndexes) {
    const entryLengthChars = files[fileIndex].length + 1;
    let targetBatch: MutableLintBatch | null = null;
    for (const batch of batches) {
      if (batch.fileIndexes.length >= maxFilesPerBatch) continue;
      if (
        batch.fileIndexes.length > 0 &&
        batch.argsLengthChars + entryLengthChars > SPAWN_ARGS_MAX_LENGTH_CHARS
      ) {
        continue;
      }
      const isLighterBatch =
        targetBatch === null ||
        batch.totalSizeBytes < targetBatch.totalSizeBytes ||
        (batch.totalSizeBytes === targetBatch.totalSizeBytes &&
          batch.fileIndexes.length < targetBatch.fileIndexes.length);
      if (isLighterBatch) targetBatch = batch;
    }
    if (targetBatch === null) {
      targetBatch = { fileIndexes: [], totalSizeBytes: 0, argsLengthChars: baseArgsLengthChars };
      batches.push(targetBatch);
    }
    targetBatch.fileIndexes.push(fileIndex);
    targetBatch.totalSizeBytes += sizeByFile.get(files[fileIndex]) ?? 0;
    targetBatch.argsLengthChars += entryLengthChars;
  }

  return batches
    .filter((batch) => batch.fileIndexes.length > 0)
    .map((batch) =>
      batch.fileIndexes
        .sort((leftIndex, rightIndex) => leftIndex - rightIndex)
        .map((fileIndex) => files[fileIndex]),
    );
};
