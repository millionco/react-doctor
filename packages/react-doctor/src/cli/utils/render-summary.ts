import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CANONICAL_GITHUB_URL,
  DOCS_URL,
  highlighter,
  SHARE_BASE_URL,
  TOP_ERRORS_DISPLAY_COUNT,
} from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildSectionDivider } from "./build-section-divider.js";
import { colorizeByScore } from "./colorize-by-score.js";
import { SCORE_PROJECTION_BAR_ROWS_ABOVE_CURSOR } from "./constants.js";
import { isJsonModeActive } from "./json-mode.js";
import { collectAffectedFiles } from "./render-diagnostics.js";
import {
  animateScoreProjection,
  printNoScoreHeader,
  printScoreHeader,
} from "./render-score-header.js";
import { resolveMeasureWidth } from "./resolve-measure-width.js";
import { wrapTextToWidth } from "./wrap-indented-text.js";
import { writeDiagnosticsDirectory } from "./write-diagnostics-directory.js";

const FOOTER_DESCRIPTION_INDENT = "  ";

// Prints a dimmed link description, wrapped to the measure but never past the
// terminal's right edge. Dim is applied per line so the SGR survives the wrap.
const printFooterDescription = (description: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const wrapWidth = resolveMeasureWidth(FOOTER_DESCRIPTION_INDENT.length);
    for (const line of wrapTextToWidth(description, wrapWidth)) {
      yield* Console.log(highlighter.dim(`${FOOTER_DESCRIPTION_INDENT}${line}`));
    }
  });

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

export interface PrintFooterInput {
  readonly diagnostics: Diagnostic[];
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly isOffline: boolean;
}

export const printFooter = (input: PrintFooterInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(buildSectionDivider());
    yield* Console.log("");
    if (!input.isOffline) {
      const shareUrl = buildShareUrl(input.diagnostics, input.scoreResult, input.projectName);
      yield* Console.log(`  ${highlighter.bold("Share:")} ${highlighter.info(shareUrl)}`);
      yield* printFooterDescription("Tell others how you did on socials");
      yield* Console.log("");
    }
    yield* Console.log(`  ${highlighter.bold("Docs:")} ${highlighter.info(DOCS_URL)}`);
    yield* printFooterDescription(
      "Learn more about fixing issues, setting up CI/CD, and configuring rules with a config file",
    );
    yield* Console.log("");
    yield* Console.log(
      `  ${highlighter.bold("GitHub:")} ${highlighter.info(CANONICAL_GITHUB_URL)}`,
    );
    yield* printFooterDescription("Report issues and star the repository!");
  });

// Writes the full diagnostics dump (diagnostics.json + one .txt per rule) and
// prints where it landed when the user asked for it (`--output-dir`) or is in
// verbose mode. Quiet callers (`--score` / `--json`) pass "stderr" so
// machine-read stdout stays clean. The stderr line writes to `process.stderr`
// directly because JSON mode no-ops `globalThis.console` (which Effect's
// `Console` resolves to) — and when JSON mode is active with `--output-dir`,
// the path is rerouted to stderr so the user can still discover it.
// v4 forbids try/catch inside Effect.gen —
// wrap the sync write in `Effect.try` (always-tagged form: `{ try, catch }`)
// and recover via `Effect.orElseSucceed`: failing to write the dump shouldn't
// block the summary, so we fall through to `null` and skip the line.
export const printDiagnosticsDump = (
  diagnostics: Diagnostic[],
  outputDirectory?: string | null,
  verbose?: boolean,
  stream: "stdout" | "stderr" = "stdout",
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const writtenDirectory = yield* Effect.try({
      try: () => writeDiagnosticsDirectory(diagnostics, outputDirectory),
      catch: (cause) => cause,
    }).pipe(Effect.orElseSucceed((): string | null => null));
    if (writtenDirectory !== null && (verbose || outputDirectory)) {
      const pathLine = highlighter.gray(`  Full diagnostics written to ${writtenDirectory}`);
      const useStderr = stream === "stderr" || (Boolean(outputDirectory) && isJsonModeActive());
      yield* useStderr
        ? Effect.sync(() => process.stderr.write(`${pathLine}\n`))
        : Console.log(pathLine);
    }
  });

export interface PrintSummaryInput {
  readonly diagnostics: Diagnostic[];
  readonly elapsedMilliseconds: number;
  readonly scoreResult: ScoreResult | null;
  // Score reachable by fixing the top errors, rendered as the bar's ghost
  // gain segment. Omitted when there's nothing to project.
  readonly potentialScore?: number | null;
  readonly totalSourceFileCount: number;
  readonly noScoreMessage: string;
  readonly verbose?: boolean;
  readonly outputDirectory?: string | null;
  // First interactive run on a TTY: draw the score bar plain, then grow the
  // projected "ghost gain" in (eased) in sync with the "you could improve"
  // line. Defaults to the static projected bar drawn by `printScoreHeader`.
  readonly animateProjection?: boolean;
}

export const printSummary = (input: PrintSummaryInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (input.scoreResult) {
      const animateProjection =
        Boolean(input.animateProjection) && input.potentialScore != null && !input.verbose;
      // When animating, draw the bar plain here; the ghost gain is grown in
      // below, in sync with the improve line.
      yield* printScoreHeader(
        input.scoreResult,
        animateProjection ? undefined : (input.potentialScore ?? undefined),
      );
      if (input.potentialScore != null) {
        const improvement = input.potentialScore - input.scoreResult.score;
        yield* Console.log(
          highlighter.gray("  You could improve ") +
            colorizeByScore(`+${improvement}%`, input.potentialScore) +
            highlighter.gray(` by fixing the top ${TOP_ERRORS_DISPLAY_COUNT} issues`),
        );
        if (animateProjection) {
          yield* animateScoreProjection(
            input.scoreResult,
            input.potentialScore,
            SCORE_PROJECTION_BAR_ROWS_ABOVE_CURSOR,
          );
        }
      }
    } else {
      yield* printNoScoreHeader(input.noScoreMessage);
    }

    yield* printDiagnosticsDump(input.diagnostics, input.outputDirectory, input.verbose);
  });
