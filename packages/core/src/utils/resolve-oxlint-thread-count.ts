import os from "node:os";
import { MIN_OXLINT_THREADS_PER_WORKER } from "../constants.js";

export const resolveOxlintThreadCount = (
  workerCount: number,
  availableCores: number = os.availableParallelism(),
): number => Math.max(MIN_OXLINT_THREADS_PER_WORKER, Math.floor(availableCores / workerCount));
