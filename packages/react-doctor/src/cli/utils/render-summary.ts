import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter, SHARE_BASE_URL, TOP_ERRORS_DISPLAY_COUNT } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { colorizeByScore } from "./colorize-by-score.js";
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

// The "list every issue" hint, printed as the very last line of a run
// (below the per-project summaries in a monorepo) so it reads as a
// closing tip rather than crowding the overview. No-op when already
// verbose or when there's nothing to list.
export const printVerboseTip = (
  diagnostics: Diagnostic[],
  isVerbose: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (isVerbose || diagnostics.length === 0) return;
    yield* Console.log(
      highlighter.dim(
        `  Tip: Run ${highlighter.info("npx react-doctor@latest --verbose")} to list every issue`,
      ),
    );
  });

export interface PrintSummaryInput {
  readonly diagnostics: Diagnostic[];
  readonly elapsedMilliseconds: number;
  readonly scoreResult: ScoreResult | null;
  // Score reachable by fixing the top errors, rendered as the bar's ghost
  // gain segment. Omitted when there's nothing to project.
  readonly potentialScore?: number | null;
  readonly projectName: string;
  readonly totalSourceFileCount: number;
  readonly noScoreMessage: string;
  readonly isOffline: boolean;
  readonly verbose?: boolean;
}

export const printSummary = (input: PrintSummaryInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (input.scoreResult) {
      yield* printScoreHeader(input.scoreResult, input.potentialScore ?? undefined);
      if (input.potentialScore != null) {
        const improvement = input.potentialScore - input.scoreResult.score;
        yield* Console.log(
          highlighter.gray("  You could improve ") +
            colorizeByScore(`+${improvement}%`, input.potentialScore) +
            highlighter.gray(` by fixing the top ${TOP_ERRORS_DISPLAY_COUNT} issues`),
        );
      }
    } else {
      yield* printNoScoreHeader(input.noScoreMessage);
    }

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
      yield* Console.log(`  ${highlighter.bold("Share:")} ${highlighter.info(shareUrl)}`);
      yield* Console.log("");
    }
  });
