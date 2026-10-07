import os from "node:os";
import { readCgroupMemoryLimitBytes } from "./read-cgroup-memory-limit-bytes.js";

export interface SystemConcurrencyFacts {
  readonly availableCores: number;
  readonly totalMemoryBytes: number;
  readonly cgroupMemoryLimitBytes: number | undefined;
}

export const readSystemConcurrencyFacts = (): SystemConcurrencyFacts => ({
  availableCores: os.availableParallelism(),
  totalMemoryBytes: os.totalmem(),
  cgroupMemoryLimitBytes: readCgroupMemoryLimitBytes(),
});
