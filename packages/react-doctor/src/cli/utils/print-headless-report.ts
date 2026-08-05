import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";
import { formatDiagnosticSite } from "./format-diagnostic-site.js";
import { formatElapsedTime } from "./format-elapsed-time.js";
import { pluralize } from "./pluralize.js";

interface PrintHeadlessReportInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly elapsedMilliseconds: number;
  readonly emptyStateMessage: string;
  readonly noScoreMessage: string;
  readonly projectName: string;
  readonly scannedFileCount: number;
  readonly scoreResult: ScoreResult | null;
  readonly skippedChecks: ReadonlyArray<string>;
}

interface CategoryCounts {
  readonly error: number;
  readonly warning: number;
}

const formatContextTag = (diagnostic: Diagnostic): string =>
  diagnostic.fileContext ? ` (${diagnostic.fileContext} file)` : "";

export const printHeadlessReport = (input: PrintHeadlessReportInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log(
      `${highlighter.success("✔")} Scanned ${pluralize(input.scannedFileCount, "file")} in ${formatElapsedTime(input.elapsedMilliseconds)}`,
    );
    yield* Console.log("");
    yield* Console.log(highlighter.bold(`React Doctor — ${input.projectName}`));
    if (input.scoreResult) {
      yield* Console.log(`Score: ${input.scoreResult.score} / 100 ${input.scoreResult.label}`);
    } else {
      yield* Console.log(highlighter.gray(input.noScoreMessage));
    }

    if (input.diagnostics.length === 0) {
      yield* Console.log("");
      yield* Console.log(highlighter.success(`✔ ${input.emptyStateMessage}`));
    } else {
      yield* Console.log("");
      yield* Console.log(highlighter.bold(pluralize(input.diagnostics.length, "issue")));
      const categoryCounts = new Map<string, CategoryCounts>();
      for (const diagnostic of input.diagnostics) {
        const counts = categoryCounts.get(diagnostic.category) ?? { error: 0, warning: 0 };
        categoryCounts.set(diagnostic.category, {
          error: counts.error + Number(diagnostic.severity === "error"),
          warning: counts.warning + Number(diagnostic.severity === "warning"),
        });
      }
      for (const [category, counts] of categoryCounts) {
        const countParts = [];
        if (counts.error > 0) countParts.push(pluralize(counts.error, "error"));
        if (counts.warning > 0) countParts.push(pluralize(counts.warning, "warning"));
        yield* Console.log(`${category}: ${countParts.join(", ")}`);
      }
      yield* Console.log("");
      for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(input.diagnostics)) {
        const representativeDiagnostic = ruleDiagnostics[0];
        if (representativeDiagnostic === undefined) continue;
        const severityIcon = representativeDiagnostic.severity === "error" ? "✖" : "⚠";
        const colorize =
          representativeDiagnostic.severity === "error" ? highlighter.error : highlighter.warn;
        const occurrenceSuffix = ruleDiagnostics.length > 1 ? ` ×${ruleDiagnostics.length}` : "";
        yield* Console.log(
          colorize(
            `${severityIcon} ${representativeDiagnostic.title ?? ruleKey}${occurrenceSuffix}`,
          ),
        );
        yield* Console.log(highlighter.gray(`  ${ruleKey}`));
        for (const diagnostic of ruleDiagnostics) {
          yield* Console.log(
            `  ${formatDiagnosticSite(diagnostic)}${formatContextTag(diagnostic)}`,
          );
        }
      }
    }

    if (input.skippedChecks.length > 0) {
      yield* Console.log("");
      yield* Console.warn(
        highlighter.warn(
          `Results are incomplete: ${input.skippedChecks.join(" and ")} checks failed.`,
        ),
      );
    }
  });
