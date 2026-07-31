import { performance } from "node:perf_hooks";
import { DEFAULT_PROJECT_SCAN_CONCURRENCY, mapWithConcurrency } from "@react-doctor/core";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "./spinner.js";

/**
 * Run one scan per project through the same bounded pool as
 * `diagnose({ projects })`, with the batch spinner and its progress counter.
 *
 * Pool members must not toggle the module-level spinner-silent flag themselves —
 * overlapping save/restore pairs would race — so the batch owns that toggle once
 * around the whole run.
 *
 * A `scanProject` that returns `null` drops the project from the results: diff
 * mode skips projects with no changed source.
 */
export const runProjectScanBatch = async <Project, Scan>(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly isQuiet: boolean;
  readonly isSilent: boolean;
  readonly scanProject: (project: Project) => Promise<Scan | null>;
}): Promise<{ completedScans: Scan[]; elapsedMilliseconds: number }> => {
  const startTime = performance.now();
  const projectCount = input.projects.length;
  const isMultiProject = projectCount > 1;
  const batchSpinner =
    isMultiProject && !input.isQuiet ? spinner(`Scanning ${projectCount} projects…`).start() : null;
  const ownsBatchSpinnerSilence = isMultiProject && input.isSilent;
  const wasSpinnerSilent = isSpinnerSilent();
  if (ownsBatchSpinnerSilence) setSpinnerSilent(true);
  let finishedProjectCount = 0;
  let scanOutcomes: ReadonlyArray<Scan | null>;
  try {
    scanOutcomes = await mapWithConcurrency(
      input.projects,
      isMultiProject ? DEFAULT_PROJECT_SCAN_CONCURRENCY : 1,
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
    completedScans: scanOutcomes.filter((scanOutcome): scanOutcome is Scan => scanOutcome !== null),
    elapsedMilliseconds: performance.now() - startTime,
  };
};
