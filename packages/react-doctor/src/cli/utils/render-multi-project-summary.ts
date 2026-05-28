import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  filterDiagnosticsForSurface,
  highlighter,
  PERFECT_SCORE,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
} from "@react-doctor/core";
import type { Diagnostic, InspectResult, ReactDoctorConfig, ScoreResult } from "@react-doctor/core";
import { colorizeByScore } from "./colorize-by-score.js";
import { printDiagnostics } from "./render-diagnostics.js";
import { printSummary } from "./render-summary.js";

const SUMMARY_BAR_WIDTH_CHARS = 20;

interface ProjectScanEntry {
  readonly projectName: string;
  readonly score: number | null;
  readonly issueCount: number;
  readonly errorCount: number;
}

const buildMiniBar = (score: number): string => {
  const filledCount = Math.round((score / PERFECT_SCORE) * SUMMARY_BAR_WIDTH_CHARS);
  const emptyCount = SUMMARY_BAR_WIDTH_CHARS - filledCount;
  return colorizeByScore("█".repeat(filledCount), score) + highlighter.dim("░".repeat(emptyCount));
};

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "OK";
  return "Needs work";
};

const buildSummaryLine = (entry: ProjectScanEntry, longestProjectNameLength: number): string => {
  const paddedName = entry.projectName.padEnd(longestProjectNameLength);
  const nameRendering =
    entry.score !== null ? colorizeByScore(paddedName, entry.score) : highlighter.dim(paddedName);

  if (entry.score === null) {
    const issueLabel = `${entry.issueCount} ${entry.issueCount === 1 ? "issue" : "issues"}`;
    return `  ${nameRendering}  ${highlighter.dim("—".repeat(SUMMARY_BAR_WIDTH_CHARS))}  ${highlighter.dim("no score")}  ${highlighter.dim(issueLabel)}`;
  }

  const scoreRendering = colorizeByScore(String(entry.score).padStart(3), entry.score);
  const bar = buildMiniBar(entry.score);
  const label = colorizeByScore(getScoreLabel(entry.score), entry.score);

  const issuesParts: string[] = [];
  if (entry.errorCount > 0) {
    issuesParts.push(
      highlighter.error(`${entry.errorCount} ${entry.errorCount === 1 ? "error" : "errors"}`),
    );
  }
  const warningCount = entry.issueCount - entry.errorCount;
  if (warningCount > 0) {
    issuesParts.push(
      highlighter.warn(`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`),
    );
  }
  const issuesRendering = issuesParts.length > 0 ? issuesParts.join(highlighter.dim(", ")) : "";

  return `  ${nameRendering}  ${scoreRendering}  ${bar}  ${label}  ${issuesRendering}`;
};

const computeAggregateScore = (
  completedScans: ReadonlyArray<{ readonly result: InspectResult }>,
): ScoreResult | null => {
  const scoredScans = completedScans.filter(
    (scan): scan is { readonly result: InspectResult & { score: ScoreResult } } =>
      scan.result.score !== null,
  );
  if (scoredScans.length === 0) return null;

  const lowestScoredScan = scoredScans.reduce((worst, scan) =>
    scan.result.score.score < worst.result.score.score ? scan : worst,
  );

  return lowestScoredScan.result.score;
};

export interface MultiProjectSummaryInput {
  readonly completedScans: ReadonlyArray<{ readonly result: InspectResult }>;
  readonly userConfig: ReactDoctorConfig | null;
  readonly verbose: boolean;
}

export const printMultiProjectSummary = (input: MultiProjectSummaryInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { completedScans, userConfig, verbose } = input;

    const allDiagnostics: Diagnostic[] = completedScans.flatMap((scan) => scan.result.diagnostics);
    const surfaceDiagnostics = filterDiagnosticsForSurface(allDiagnostics, "cli", userConfig);

    if (surfaceDiagnostics.length > 0) {
      yield* Console.log("");
      yield* printDiagnostics(surfaceDiagnostics, verbose, "");
    }

    const aggregateScore = computeAggregateScore(completedScans);
    const totalSourceFileCount = completedScans.reduce(
      (sum, scan) => sum + scan.result.project.sourceFileCount,
      0,
    );
    const totalElapsedMilliseconds = completedScans.reduce(
      (sum, scan) => sum + scan.result.elapsedMilliseconds,
      0,
    );

    yield* printSummary({
      diagnostics: surfaceDiagnostics,
      elapsedMilliseconds: totalElapsedMilliseconds,
      scoreResult: aggregateScore,
      projectName: completedScans.map((scan) => scan.result.project.projectName).join(", "),
      totalSourceFileCount,
      noScoreMessage: "Score unavailable.",
      isOffline: true,
      verbose,
    });

    const entries: ProjectScanEntry[] = completedScans.map((scan) => {
      const errorCount = scan.result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ).length;
      return {
        projectName: scan.result.project.projectName,
        score: scan.result.score?.score ?? null,
        issueCount: scan.result.diagnostics.length,
        errorCount,
      };
    });

    const longestProjectNameLength = Math.max(...entries.map((entry) => entry.projectName.length));

    for (const entry of entries) {
      yield* Console.log(buildSummaryLine(entry, longestProjectNameLength));
    }

    yield* Console.log("");
  });
