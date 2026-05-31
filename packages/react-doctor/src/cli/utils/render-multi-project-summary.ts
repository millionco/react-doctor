import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  filterDiagnosticsForSurface,
  highlighter,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
} from "@react-doctor/core";
import type { Diagnostic, InspectResult, ReactDoctorConfig, ScoreResult } from "@react-doctor/core";
import { colorizeByScore } from "./colorize-by-score.js";
import { computeProjectedScore } from "./compute-score-projection.js";
import { buildRulePriorityMap } from "./diagnostic-grouping.js";
import { formatElapsedTime, printDiagnostics } from "./render-diagnostics.js";
import { printSummary, printVerboseTip } from "./render-summary.js";

interface ProjectScanEntry {
  readonly projectName: string;
  readonly score: number | null;
  readonly issueCount: number;
  readonly errorCount: number;
}

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
    return `  ${nameRendering}  ${highlighter.dim("no score")}  ${highlighter.dim(issueLabel)}`;
  }

  const scoreRendering = colorizeByScore(String(entry.score).padStart(3), entry.score);
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

  return `  ${nameRendering}  ${scoreRendering}  ${label}  ${issuesRendering}`;
};

// The aggregate score shown for a monorepo is its WORST project's score
// (a chain is only as strong as its weakest link), so the score
// projection is computed against that same project.
const findLowestScoredScan = (
  completedScans: ReadonlyArray<{ readonly result: InspectResult }>,
): { readonly result: InspectResult & { score: ScoreResult } } | null => {
  const scoredScans = completedScans.filter(
    (scan): scan is { readonly result: InspectResult & { score: ScoreResult } } =>
      scan.result.score !== null,
  );
  if (scoredScans.length === 0) return null;

  return scoredScans.reduce((worst, scan) =>
    scan.result.score.score < worst.result.score.score ? scan : worst,
  );
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

    // Each diagnostic's `filePath` is relative to its own project root,
    // so the code-frame renderer needs to resolve per-diagnostic rather
    // than against one shared root (there isn't one across projects).
    const projectRootByDiagnostic = new WeakMap<Diagnostic, string>();
    for (const scan of completedScans) {
      for (const diagnostic of scan.result.diagnostics) {
        projectRootByDiagnostic.set(diagnostic, scan.result.project.rootDirectory);
      }
    }
    const resolveDiagnosticSourceRoot = (diagnostic: Diagnostic): string =>
      projectRootByDiagnostic.get(diagnostic) ?? "";

    // Single aggregate scan line in place of the per-project spinner
    // success lines (suppressed via `suppressScanSummary`). Scans run
    // sequentially, so summing each project's scan duration matches the
    // wall-clock total.
    //
    // Count UNIQUE scanned files by absolute path: nested workspace
    // packages (a parent whose tree contains a child package) scan the
    // shared files in BOTH projects, so naively summing per-project
    // counts overstates the real total. A scan that reported no file
    // paths can't be deduped, so it contributes its own reported count
    // (this fallback is per-scan, not all-or-nothing — the other
    // projects still dedupe against each other).
    const uniqueScannedFilePaths = new Set<string>();
    let fileCountFromScansWithoutPaths = 0;
    for (const scan of completedScans) {
      const scannedFilePaths = scan.result.scannedFilePaths;
      if (scannedFilePaths && scannedFilePaths.length > 0) {
        for (const filePath of scannedFilePaths) uniqueScannedFilePaths.add(filePath);
      } else {
        fileCountFromScansWithoutPaths +=
          scan.result.scannedFileCount ?? scan.result.project.sourceFileCount;
      }
    }
    const totalScannedFileCount = uniqueScannedFilePaths.size + fileCountFromScansWithoutPaths;
    const totalScanElapsedMilliseconds = completedScans.reduce(
      (sum, scan) => sum + (scan.result.scanElapsedMilliseconds ?? scan.result.elapsedMilliseconds),
      0,
    );
    yield* Console.log(
      `${highlighter.success("✔")} Scanned ${totalScannedFileCount} ${totalScannedFileCount === 1 ? "file" : "files"} in ${formatElapsedTime(totalScanElapsedMilliseconds)}`,
    );

    if (surfaceDiagnostics.length > 0) {
      yield* Console.log("");
      yield* printDiagnostics(
        surfaceDiagnostics,
        verbose,
        resolveDiagnosticSourceRoot,
        buildRulePriorityMap(completedScans.map((scan) => scan.result.score)),
      );
    }

    const lowestScoredScan = findLowestScoredScan(completedScans);
    const aggregateScore = lowestScoredScan?.result.score ?? null;
    const totalSourceFileCount = completedScans.reduce(
      (sum, scan) => sum + scan.result.project.sourceFileCount,
      0,
    );
    const totalElapsedMilliseconds = completedScans.reduce(
      (sum, scan) => sum + scan.result.elapsedMilliseconds,
      0,
    );

    // Project the worst project's score: the displayed top errors are
    // picked across all projects, but only removing them from the worst
    // project's diagnostics moves the aggregate (its score IS the total).
    const potentialScore = lowestScoredScan
      ? yield* Effect.promise(() =>
          computeProjectedScore(
            surfaceDiagnostics,
            lowestScoredScan.result.diagnostics,
            lowestScoredScan.result.score,
          ),
        )
      : null;

    yield* printSummary({
      diagnostics: surfaceDiagnostics,
      elapsedMilliseconds: totalElapsedMilliseconds,
      scoreResult: aggregateScore,
      potentialScore,
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

    yield* Console.log("");
    for (const entry of entries) {
      yield* Console.log(buildSummaryLine(entry, longestProjectNameLength));
    }

    yield* Console.log("");
    yield* printVerboseTip(surfaceDiagnostics, verbose);
  });
