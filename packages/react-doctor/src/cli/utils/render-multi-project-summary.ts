import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import type { Diagnostic, InspectResult, ScoreResult } from "@react-doctor/core";
import { colorizeByScore } from "./colorize-by-score.js";
import { countUniqueScannedFiles } from "./count-unique-scanned-files.js";
import { scoreBandLabel } from "./score-band-label.js";
import { filterScansForSurface } from "./filter-scans-for-surface.js";
import type { SurfaceFilterableScan } from "./filter-scans-for-surface.js";
import { computeProjectedScore } from "./compute-score-projection.js";
import { buildRulePriorityMap } from "./diagnostic-grouping.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { isCodingAgentEnvironment } from "./is-ci-environment.js";
import { canAnimateOnboarding } from "./onboarding-pacing.js";
import { formatElapsedTime, printDiagnostics } from "./render-diagnostics.js";
import { printFooter, printSummary } from "./render-summary.js";
import { shouldRenderHyperlinks } from "./should-render-hyperlinks.js";

interface ProjectScanEntry {
  readonly projectName: string;
  readonly score: number | null;
  readonly issueCount: number;
  readonly errorCount: number;
}

const buildSummaryLine = (entry: ProjectScanEntry, longestProjectNameLength: number): string => {
  const paddedName = entry.projectName.padEnd(longestProjectNameLength);
  const nameRendering =
    entry.score !== null ? colorizeByScore(paddedName, entry.score) : highlighter.dim(paddedName);

  if (entry.score === null) {
    const issueLabel = `${entry.issueCount} ${entry.issueCount === 1 ? "issue" : "issues"}`;
    return `  ${nameRendering}  ${highlighter.dim("no score")}  ${highlighter.dim(issueLabel)}`;
  }

  const scoreRendering = colorizeByScore(String(entry.score).padStart(3), entry.score);
  const label = colorizeByScore(scoreBandLabel(entry.score), entry.score);

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
  completedScans: ReadonlyArray<SurfaceFilterableScan>,
): (SurfaceFilterableScan & { readonly result: InspectResult & { score: ScoreResult } }) | null => {
  const scoredScans = completedScans.filter(
    (
      scan,
    ): scan is SurfaceFilterableScan & {
      readonly result: InspectResult & { score: ScoreResult };
    } => scan.result.score !== null,
  );
  if (scoredScans.length === 0) return null;

  return scoredScans.reduce((worst, scan) =>
    scan.result.score.score < worst.result.score.score ? scan : worst,
  );
};

export interface MultiProjectSummaryInput {
  readonly completedScans: ReadonlyArray<SurfaceFilterableScan>;
  readonly categoryFilters?: ReadonlySet<string>;
  readonly verbose: boolean;
  readonly outputDirectory?: string | null;
  readonly isOffline: boolean;
  readonly projectName: string;
  readonly totalElapsedMilliseconds: number;
}

export const printMultiProjectSummary = (input: MultiProjectSummaryInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { completedScans, verbose, isOffline, projectName, totalElapsedMilliseconds } = input;
    const categoryFilters = input.categoryFilters ?? new Set<string>();

    // Report animations (category count-up + score-projection ghost gain) play
    // on every interactive aggregate render, mirroring the single-project path
    // in `inspect.ts`. The first-run section pacing stays single-project-only.
    const animateRender = !verbose && canAnimateOnboarding(process.stdout);

    const surfaceDiagnostics = filterScansForSurface(completedScans, "cli");
    const displayDiagnostics = filterDiagnosticsByCategories(surfaceDiagnostics, categoryFilters);
    const scoreDiagnostics = new Set(filterScansForSurface(completedScans, "score"));
    const displayedScoreDiagnostics = displayDiagnostics.filter((diagnostic) =>
      scoreDiagnostics.has(diagnostic),
    );

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
    // through a bounded concurrent pool, so the caller passes the
    // wall-clock total rather than summing per-project durations.
    //
    const totalScannedFileCount = countUniqueScannedFiles(
      completedScans.map((scan) => scan.result),
    );
    yield* Console.log(
      `${highlighter.success("✔")} Scanned ${totalScannedFileCount} ${totalScannedFileCount === 1 ? "file" : "files"} in ${formatElapsedTime(totalElapsedMilliseconds)}`,
    );

    if (displayDiagnostics.length > 0) {
      yield* Console.log("");
      yield* printDiagnostics(
        displayDiagnostics,
        verbose,
        resolveDiagnosticSourceRoot,
        buildRulePriorityMap(completedScans.map((scan) => scan.result.score)),
        isCodingAgentEnvironment(),
        { animateCountUp: animateRender },
        shouldRenderHyperlinks(process.stdout),
      );
    }

    const lowestScoredScan = findLowestScoredScan(completedScans);
    const aggregateScore = lowestScoredScan?.result.score ?? null;
    const totalSourceFileCount = completedScans.reduce(
      (sum, scan) => sum + scan.result.project.sourceFileCount,
      0,
    );

    // Project the worst project's score: the displayed top errors are
    // picked across all projects, but only removing them from the worst
    // project's diagnostics moves the aggregate (its score IS the total).
    const potentialScore = lowestScoredScan
      ? yield* Effect.promise(() =>
          computeProjectedScore(
            displayedScoreDiagnostics,
            filterScansForSurface([lowestScoredScan], "score"),
            lowestScoredScan.result.score,
          ),
        )
      : null;

    yield* printSummary({
      diagnostics: displayDiagnostics,
      elapsedMilliseconds: totalElapsedMilliseconds,
      scoreResult: aggregateScore,
      potentialScore,
      totalSourceFileCount,
      noScoreMessage: "Score unavailable.",
      verbose,
      outputDirectory: input.outputDirectory,
      animateProjection: animateRender,
    });

    const entries: ProjectScanEntry[] = completedScans.map((scan) => {
      const projectDiagnostics = filterDiagnosticsByCategories(
        filterScansForSurface([scan], "cli"),
        categoryFilters,
      );
      const errorCount = projectDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ).length;
      return {
        projectName: scan.result.project.projectName,
        score: scan.result.score?.score ?? null,
        issueCount: projectDiagnostics.length,
        errorCount,
      };
    });

    const longestProjectNameLength = Math.max(...entries.map((entry) => entry.projectName.length));

    yield* Console.log("");
    for (const entry of entries) {
      yield* Console.log(buildSummaryLine(entry, longestProjectNameLength));
    }

    yield* printFooter({
      diagnostics: displayDiagnostics,
      scoreResult: aggregateScore,
      projectName,
      isOffline,
    });
  });
