import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { buildRulePromptUrl, highlighter, SHARE_BASE_URL } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { collectAffectedFiles } from "./render-diagnostics.js";
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
  isVerbose: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const totalIssueCount = diagnostics.length;
    const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warningCount = diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length;
    const issueCountColor =
      errorCount > 0 ? highlighter.error : warningCount > 0 ? highlighter.warn : highlighter.dim;
    const issueText = issueCountColor(
      `${totalIssueCount} ${totalIssueCount === 1 ? "issue" : "issues"}`,
    );
    yield* Console.log(`  ${issueText}`);
    if (!isVerbose && totalIssueCount > 0) {
      const exampleDiagnostic =
        diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? diagnostics[0];
      yield* Console.log(
        highlighter.dim(
          `  Run ${highlighter.info("npx react-doctor@latest --verbose")} to list every issue with its fix-recipe URL`,
        ),
      );
      yield* Console.log(
        highlighter.dim(
          `  Each rule links a canonical fix recipe to fetch & follow before fixing, e.g. ${highlighter.info(buildRulePromptUrl(exampleDiagnostic.plugin, exampleDiagnostic.rule))}`,
        ),
      );
    }
  });

export interface PrintSummaryInput {
  readonly diagnostics: Diagnostic[];
  readonly elapsedMilliseconds: number;
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly totalSourceFileCount: number;
  readonly noScoreMessage: string;
  readonly isOffline: boolean;
  readonly verbose?: boolean;
}

export const printSummary = (input: PrintSummaryInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (input.scoreResult) {
      yield* printScoreHeader(input.scoreResult, input.projectName);
    } else {
      yield* printNoScoreHeader(input.noScoreMessage);
    }

    yield* printCountsSummaryLine(input.diagnostics, input.verbose ?? false);

    // v4 forbids try/catch inside Effect.gen — wrap the sync write
    // in `Effect.try` (always-tagged form: `{ try, catch }`) and
    // recover via `Effect.orElseSucceed`. Failing to write the dump
    // shouldn't block the summary, so we fall through to `null` and
    // skip the line.
    const diagnosticsDirectory = yield* Effect.try({
      try: () => writeDiagnosticsDirectory(input.diagnostics),
      catch: (cause) => cause,
    }).pipe(Effect.orElseSucceed(() => null as string | null));
    if (diagnosticsDirectory !== null && input.verbose) {
      yield* Console.log(highlighter.gray(`  Full diagnostics written to ${diagnosticsDirectory}`));
    }

    if (!input.isOffline) {
      yield* Console.log("");
      const shareUrl = buildShareUrl(input.diagnostics, input.scoreResult, input.projectName);
      yield* Console.log(`  ${highlighter.bold("→ Share:")} ${highlighter.info(shareUrl)}`);
      yield* Console.log("");
    }
  });
