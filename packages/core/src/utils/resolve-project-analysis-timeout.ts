import {
  PROJECT_ANALYSIS_WORKER_TIMEOUT_CEILING_MS,
  PROJECT_ANALYSIS_WORKER_TIMEOUT_MS,
  PROJECT_ANALYSIS_WORKER_TIMEOUT_MS_PER_SOURCE_FILE,
} from "../constants.js";

export const resolveProjectAnalysisTimeout = (sourceFileCount: number): number =>
  Math.min(
    PROJECT_ANALYSIS_WORKER_TIMEOUT_CEILING_MS,
    Math.max(
      PROJECT_ANALYSIS_WORKER_TIMEOUT_MS,
      sourceFileCount * PROJECT_ANALYSIS_WORKER_TIMEOUT_MS_PER_SOURCE_FILE,
    ),
  );
