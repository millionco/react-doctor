import { performance } from "node:perf_hooks";
import { DEFAULT_PROJECT_SCAN_CONCURRENCY, mapWithConcurrency } from "@react-doctor/core";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "./spinner.js";

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
