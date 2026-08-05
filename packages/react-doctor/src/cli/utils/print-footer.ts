import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { SHARE_BASE_URL } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildFooterLinkLines } from "./build-footer-link-lines.js";
import { buildSectionDivider } from "./build-section-divider.js";
import { collectAffectedFiles } from "./collect-affected-files.js";

interface PrintFooterInput {
  readonly diagnostics: Diagnostic[];
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly isOffline: boolean;
}

const buildShareUrl = (input: PrintFooterInput): string => {
  const errorCount = input.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = input.diagnostics.length - errorCount;
  const affectedFileCount = collectAffectedFiles(input.diagnostics).size;
  const parameters = new URLSearchParams({ p: input.projectName });
  if (input.scoreResult) parameters.set("s", String(input.scoreResult.score));
  if (errorCount > 0) parameters.set("e", String(errorCount));
  if (warningCount > 0) parameters.set("w", String(warningCount));
  if (affectedFileCount > 0) parameters.set("f", String(affectedFileCount));
  return `${SHARE_BASE_URL}?${parameters.toString()}`;
};

export const printFooter = (input: PrintFooterInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(buildSectionDivider());
    yield* Console.log("");
    const shareUrl = input.isOffline ? null : buildShareUrl(input);
    for (const line of buildFooterLinkLines({ shareUrl })) yield* Console.log(line);
  });
