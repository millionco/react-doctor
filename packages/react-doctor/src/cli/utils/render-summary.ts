import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter, SHARE_BASE_URL } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/types";
import { collectAffectedFiles, formatElapsedTime } from "./render-diagnostics.js";
import { printNoScoreHeader, printScoreHeader } from "./render-score-header.js";
import { writeDiagnosticsDirectory } from "./write-diagnostics-directory.js";

const buildShareUrl = (
  diagnostics: Diagnostic[],
  scoreResult: ScoreResult | null,
  projectName: string,
): string => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;

  const params = new URLSearchParams();
  params.set("p", projectName);
  if (scoreResult) params.set("s", String(scoreResult.score));
  if (errorCount > 0) params.set("e", String(errorCount));
  if (warningCount > 0) params.set("w", String(warningCount));
  if (affectedFileCount > 0) params.set("f", String(affectedFileCount));

  return `${SHARE_BASE_URL}?${params.toString()}`;
};

const printCountsSummaryLine = (
  diagnostics: Diagnostic[],
  totalSourceFileCount: number,
  elapsedMilliseconds: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warningCount = diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length;
    const affectedFileCount = collectAffectedFiles(diagnostics).size;
    const totalIssueCount = diagnostics.length;
    const elapsedTimeLabel = formatElapsedTime(elapsedMilliseconds);

    const issueCountColor =
      errorCount > 0 ? highlighter.error : warningCount > 0 ? highlighter.warn : highlighter.dim;
    const issueCountText = `${totalIssueCount} ${totalIssueCount === 1 ? "issue" : "issues"}`;
    const fileCountText =
      totalSourceFileCount > 0
        ? `across ${affectedFileCount}/${totalSourceFileCount} files`
        : `across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}`;
    const elapsedTimeText = `in ${elapsedTimeLabel}`;

    yield* Console.log(
      `  ${issueCountColor(issueCountText)} ${highlighter.dim(`${fileCountText}  ${elapsedTimeText}`)}`,
    );
  });

export interface PrintSummaryInput {
  readonly diagnostics: Diagnostic[];
  readonly elapsedMilliseconds: number;
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly totalSourceFileCount: number;
  readonly noScoreMessage: string;
  readonly isOffline: boolean;
}

export const printSummary = (input: PrintSummaryInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (input.scoreResult) {
      yield* printScoreHeader(input.scoreResult);
    } else {
      yield* printNoScoreHeader(input.noScoreMessage);
    }

    yield* printCountsSummaryLine(
      input.diagnostics,
      input.totalSourceFileCount,
      input.elapsedMilliseconds,
    );

    try {
      const diagnosticsDirectory = writeDiagnosticsDirectory(input.diagnostics);
      yield* Console.log(highlighter.gray(`  Full diagnostics written to ${diagnosticsDirectory}`));
    } catch {
      /* swallow — failing to write the dump shouldn't block the summary */
    }

    if (!input.isOffline) {
      yield* Console.log("");
      const shareUrl = buildShareUrl(input.diagnostics, input.scoreResult, input.projectName);
      yield* Console.log(
        `  ${highlighter.bold("→ Share your results:")} ${highlighter.info(shareUrl)}`,
      );
      yield* Console.log("");
    }
  });
