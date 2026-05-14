import { SHARE_BASE_URL } from "../constants.js";
import type { Diagnostic } from "../types/diagnostic.js";
import type { ScoreResult } from "../types/score.js";
import { highlighter } from "../core/highlighter.js";
import { logger } from "../core/logger.js";
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
): void => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
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

  logger.log(
    `  ${issueCountColor(issueCountText)} ${highlighter.dim(`${fileCountText}  ${elapsedTimeText}`)}`,
  );
};

export const printSummary = (
  diagnostics: Diagnostic[],
  elapsedMilliseconds: number,
  scoreResult: ScoreResult | null,
  projectName: string,
  totalSourceFileCount: number,
  noScoreMessage: string,
  isOffline: boolean,
): void => {
  if (scoreResult) {
    printScoreHeader(scoreResult);
  } else {
    printNoScoreHeader(noScoreMessage);
  }

  printCountsSummaryLine(diagnostics, totalSourceFileCount, elapsedMilliseconds);

  try {
    const diagnosticsDirectory = writeDiagnosticsDirectory(diagnostics);
    logger.log(highlighter.gray(`  Full diagnostics written to ${diagnosticsDirectory}`));
  } catch {
    /* swallow — failing to write the dump shouldn't block the summary */
  }

  if (!isOffline) {
    logger.break();
    const shareUrl = buildShareUrl(diagnostics, scoreResult, projectName);
    logger.log(`  ${highlighter.bold("→ Share your results:")} ${highlighter.info(shareUrl)}`);
  }
};
