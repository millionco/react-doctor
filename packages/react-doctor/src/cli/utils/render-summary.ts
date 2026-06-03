import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CANONICAL_GITHUB_URL,
  CI_URL,
  DOCS_URL,
  highlighter,
  SHARE_BASE_URL,
  TOP_ERRORS_DISPLAY_COUNT,
} from "@react-doctor/core";
import { CI_TRUST_COMPANIES } from "./constants.js";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildSectionDivider } from "./build-section-divider.js";
import { colorizeByScore } from "./colorize-by-score.js";
import { SCORE_PROJECTION_BAR_ROWS_ABOVE_CURSOR } from "./constants.js";
import { collectAffectedFiles } from "./render-diagnostics.js";
import {
  animateScoreProjection,
  printNoScoreHeader,
  printScoreHeader,
} from "./render-score-header.js";
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
      yield* Console.log(highlighter.dim("  Tell others how you did on socials"));
      yield* Console.log("");
    }
    yield* Console.log(`  ${highlighter.bold("Docs:")} ${highlighter.info(DOCS_URL)}`);
    yield* Console.log(
      highlighter.dim(
        "  Learn more about fixing issues, setting up CI/CD, and configuring rules with a config file",
      ),
    );
    yield* Console.log("");
    yield* Console.log(
      `  ${highlighter.bold("GitHub:")} ${highlighter.info(CANONICAL_GITHUB_URL)}`,
    );
    yield* Console.log(highlighter.dim("  Report issues and star the repository!"));
    yield* Console.log("");
    // GitHub Actions closes the footer because it's the highest-leverage
    // action a user can take after reading the report — set it up once and
    // React Doctor runs on every PR forever — and sitting last in the footer
    // makes it the final thing they read before the handoff prompt that
    // follows (recency wins over primacy here, since the prompt itself
    // references the same recommendation). The pitch matches the other footer
    // items' shape (bold label : URL + dim description) while carrying the
    // "why" in two lines: incremental backlog rollout, then social proof from
    // teams already running it. The two-line split keeps each description
    // under `OUTPUT_DETAIL_WRAP_WIDTH_CHARS` (88) so neither soft-wraps at
    // 100c. The `CI_URL` constant + the `/ci` docs path are unchanged — the
    // user-facing wording is what shifted from "CI" to "GitHub Actions" so
    // the label names the concrete thing this CLI actually installs.
    yield* Console.log(`  ${highlighter.bold("GitHub Actions:")} ${highlighter.info(CI_URL)}`);
    yield* Console.log(
      highlighter.dim("  Scan every pull request: new PRs stay clean while you fix the backlog"),
    );
    yield* Console.log(highlighter.dim(`  Used by teams at ${CI_TRUST_COMPANIES}`));
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
  });
