import { PROJECT_ANALYSIS_WORKER_MEMORY_BUDGET_BYTES } from "../constants.js";
import {
  type SystemConcurrencyFacts,
  readSystemConcurrencyFacts,
} from "./read-system-concurrency-facts.js";

export const resolveProjectAnalysisConcurrency = (
  facts: SystemConcurrencyFacts = readSystemConcurrencyFacts(),
): number => {
  const availableMemoryBytes = Math.min(
    facts.totalMemoryBytes,
    facts.cgroupMemoryLimitBytes ?? Number.POSITIVE_INFINITY,
  );
  const memoryBoundedWorkerCount = Math.floor(
    availableMemoryBytes / PROJECT_ANALYSIS_WORKER_MEMORY_BUDGET_BYTES,
  );
  return Math.max(1, Math.min(facts.availableCores, memoryBoundedWorkerCount));
};
