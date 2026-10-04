import { performance } from "node:perf_hooks";
import {
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  MIN_SCAN_CONCURRENCY,
  PROJECT_SCANS_IN_FLIGHT_PER_OXLINT_WORKER,
  mapWithConcurrency,
} from "@react-doctor/core";
import { partitionProjectScanOutcomes, type ProjectScanOutcome } from "./project-scan-outcome.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "./spinner.js";

export type { ProjectScanOutcome } from "./project-scan-outcome.js";

interface RunProjectScanBatchInput<Project, Scan, SkippedScan> {
  readonly projects: ReadonlyArray<Project>;
  readonly isQuiet: boolean;
  readonly isSilent: boolean;
  /**
   * The invocation-wide oxlint worker count. Every project's lint batches
   * already queue through one shared `OxlintSpawnSlots` pool, so the batch
   * keeps a multiple of that many projects in flight — otherwise a workspace
   * of many one-batch projects, each ending in a score round-trip, could never
   * fill the pool.
   */
  readonly oxlintConcurrency?: number;
  readonly scanProject: (project: Project) => Promise<ProjectScanOutcome<Scan, SkippedScan>>;
}

interface ProjectScanBatchResult<Scan, SkippedScan> {
  readonly completedScans: Scan[];
  readonly skippedScans: SkippedScan[];
  readonly elapsedMilliseconds: number;
}

/**
 * Run one scan per project through the same bounded pool as
 * `diagnose({ projects })`, with the batch spinner and its progress counter.
 *
 * Pool members must not toggle the module-level spinner-silent flag themselves —
 * overlapping save/restore pairs would race — so the batch owns that toggle once
 * around the whole run.
 *
 */
export const runProjectScanBatch = async <Project, Scan, SkippedScan>(
  input: RunProjectScanBatchInput<Project, Scan, SkippedScan>,
): Promise<ProjectScanBatchResult<Scan, SkippedScan>> => {
  const startTime = performance.now();
  const projectCount = input.projects.length;
  const isMultiProject = projectCount > 1;
  const batchSpinner =
    isMultiProject && !input.isQuiet ? spinner(`Scanning ${projectCount} projects…`).start() : null;
  const ownsBatchSpinnerSilence = isMultiProject && input.isSilent;
  const wasSpinnerSilent = isSpinnerSilent();
  if (ownsBatchSpinnerSilence) setSpinnerSilent(true);
  const projectConcurrency = Math.max(
    DEFAULT_PROJECT_SCAN_CONCURRENCY,
    (input.oxlintConcurrency ?? MIN_SCAN_CONCURRENCY) * PROJECT_SCANS_IN_FLIGHT_PER_OXLINT_WORKER,
  );
  let finishedProjectCount = 0;
  let scanOutcomes: ReadonlyArray<ProjectScanOutcome<Scan, SkippedScan>>;
  try {
    scanOutcomes = await mapWithConcurrency(
      input.projects,
      isMultiProject ? projectConcurrency : 1,
      async (project) => {
        const scanOutcome = await input.scanProject(project);
        finishedProjectCount += 1;
        batchSpinner?.update(
          `Scanning ${projectCount} projects… (${finishedProjectCount}/${projectCount})`,
        );
        return scanOutcome;
      },
    );
  } finally {
    if (ownsBatchSpinnerSilence) setSpinnerSilent(wasSpinnerSilent);
    batchSpinner?.stop();
  }
  return {
    ...partitionProjectScanOutcomes(scanOutcomes),
    elapsedMilliseconds: performance.now() - startTime,
  };
};
