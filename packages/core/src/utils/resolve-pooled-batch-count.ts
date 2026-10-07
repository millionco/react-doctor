import {
  OXLINT_POOLED_BATCHES_PER_WORKER,
  OXLINT_POOLED_MIN_FILES_PER_BATCH,
} from "../constants.js";

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
