import { buildDiagnosticIdentity, getRuleMetadata } from "@react-doctor/core";
import type { Diagnostic as CoreDiagnostic, DiagnosticRelatedLocation } from "@react-doctor/core";
import {
  DiagnosticSeverity,
  DiagnosticTag,
  type Diagnostic as LspDiagnostic,
  type DiagnosticRelatedInformation,
  type Range,
} from "vscode-languageserver";
import { URI } from "vscode-uri";
import { DIAGNOSTIC_SOURCE } from "../constants.js";
import type { ReactDoctorDiagnosticData } from "../types.js";
import { rangeFromByteSpan, rangeFromLineColumn } from "../text/positions.js";

export interface MapDiagnosticInput {
  readonly diagnostic: CoreDiagnostic;
  /** Absolute fs path of the file this diagnostic belongs to. */
  readonly fsPath: string;
  /** Text of `fsPath` for precise byte-span ranges; `null` → line/col fallback. */
  readonly text: string | null;
}

/**
 * Maps engine severity to LSP severity, demoting weak-signal rule
 * families (`design`) to `Information` so style nudges sit quietly under
 * the real correctness/perf/security findings instead of competing with
 * them in the editor gutter and Problems panel.
 */
const toLspSeverity = (diagnostic: CoreDiagnostic): DiagnosticSeverity => {
  const tags = getRuleMetadata(diagnostic.plugin, diagnostic.rule)?.tags ?? [];
  if (tags.includes("design")) return DiagnosticSeverity.Information;
  return diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
};

/**
 * Dead-code findings ("unused file", "unused export", …) read best with
 * the faded `Unnecessary` treatment editors apply to that tag.
 */
const resolveTags = (diagnostic: CoreDiagnostic): DiagnosticTag[] | undefined =>
  diagnostic.category === "Dead Code" || diagnostic.plugin === "deslop"
    ? [DiagnosticTag.Unnecessary]
    : undefined;

const resolveRange = (
  text: string | null,
  offset: number | undefined,
  length: number | undefined,
  line: number,
  column: number,
): Range =>
  text !== null && offset !== undefined
    ? rangeFromByteSpan(text, offset, length ?? 0)
    : rangeFromLineColumn(text, line, column);

// All related locations resolve against the parent diagnostic's already-
// canonicalized `fsPath` / `text` rather than each location's own `filePath`.
// oxlint only emits secondary labels in the SAME file as the primary span, so
// the two always coincide today. Critically, only the primary diagnostic's
// path is run through the scan-runner's overlay/path resolution — a related
// location's raw `filePath` would still point at the overlay temp dir for an
// unsaved-buffer scan, so deriving the URI from it would break "jump to" links.
// Cross-file related locations would need that same path resolution plus a
// TextProvider for the other file's content; revisit if oxlint starts emitting
// them.
const toRelatedInformation = (
  related: ReadonlyArray<DiagnosticRelatedLocation>,
  fsPath: string,
  text: string | null,
): DiagnosticRelatedInformation[] => {
  const uri = URI.file(fsPath).toString();
  return related.map((location) => ({
    location: {
      uri,
      range: resolveRange(text, location.offset, location.length, location.line, location.column),
    },
    message: location.message || "Related location",
  }));
};

/**
 * Converts a core React Doctor diagnostic into an LSP diagnostic with a
 * precise range, rule code + docs link, related locations, and a
 * structured `data` payload the hover / code-action handlers consume.
 */
export const toLspDiagnostic = (input: MapDiagnosticInput): LspDiagnostic => {
  const { diagnostic, fsPath, text } = input;
  const ruleId = `${diagnostic.plugin}/${diagnostic.rule}`;
  const range = resolveRange(
    text,
    diagnostic.offset,
    diagnostic.length,
    diagnostic.line,
    diagnostic.column,
  );

  const data: ReactDoctorDiagnosticData = {
    identity: buildDiagnosticIdentity({
      filePath: fsPath,
      line: diagnostic.line,
      column: diagnostic.column,
      plugin: diagnostic.plugin,
      rule: diagnostic.rule,
    }),
    plugin: diagnostic.plugin,
    rule: diagnostic.rule,
    ruleId,
    category: diagnostic.category,
    help: diagnostic.help,
    url: diagnostic.url ?? null,
    suppressionHint: diagnostic.suppressionHint ?? null,
    line: diagnostic.line,
    column: diagnostic.column,
    fsPath,
  };

  const tags = resolveTags(diagnostic);
  const relatedInformation =
    diagnostic.relatedLocations && diagnostic.relatedLocations.length > 0
      ? toRelatedInformation(diagnostic.relatedLocations, fsPath, text)
      : undefined;

  return {
    range,
    severity: toLspSeverity(diagnostic),
    code: ruleId,
    ...(diagnostic.url ? { codeDescription: { href: diagnostic.url } } : {}),
    source: DIAGNOSTIC_SOURCE,
    message: diagnostic.message,
    ...(tags ? { tags } : {}),
    ...(relatedInformation ? { relatedInformation } : {}),
    data,
  };
};
