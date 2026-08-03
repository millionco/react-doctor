import { calculateScore, mapWithConcurrency } from "@react-doctor/core";
import type { SurfaceFilterableScan } from "./filter-scans-for-surface.js";
import { filterScansForSurface } from "./filter-scans-for-surface.js";
import { METRIC, SCORE_RETRY_MAX_CONCURRENCY } from "./constants.js";
import { hasIncompleteScoreAnalysis } from "./has-incomplete-score-analysis.js";
import { recordCount } from "./record-metric.js";

export interface RetryableProjectScore extends SurfaceFilterableScan {
  readonly isScoreDisabled: boolean;
}

export const retryMissingProjectScores = async <ProjectScan extends RetryableProjectScore>(
  projectScans: ReadonlyArray<ProjectScan>,
): Promise<ProjectScan[]> =>
  mapWithConcurrency(projectScans, SCORE_RETRY_MAX_CONCURRENCY, async (projectScan) => {
    const shouldRetry =
      projectScan.result.score === null &&
      !projectScan.isScoreDisabled &&
      !hasIncompleteScoreAnalysis(projectScan.result.skippedChecks);
    if (!shouldRetry) return projectScan;

    const score = await calculateScore(filterScansForSurface([projectScan], "score"));
    recordCount(METRIC.scanScoreRetry, 1, { succeeded: score !== null });
    return score === null
      ? projectScan
      : { ...projectScan, result: { ...projectScan.result, score } };
  });
