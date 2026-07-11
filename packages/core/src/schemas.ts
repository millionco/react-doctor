import { FRAMEWORK_TOKENS } from "oxlint-plugin-react-doctor";
import * as Schema from "effect/Schema";

export const Severity = Schema.Literals(["error", "warning"]);
export type Severity = Schema.Schema.Type<typeof Severity>;

export class DiagnosticRelatedLocation extends Schema.Class<DiagnosticRelatedLocation>(
  "DiagnosticRelatedLocation",
)({
  filePath: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  offset: Schema.optional(Schema.Number),
  length: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  message: Schema.String,
}) {}

export class Diagnostic extends Schema.Class<Diagnostic>("Diagnostic")({
  filePath: Schema.String,
  plugin: Schema.String,
  rule: Schema.String,
  severity: Severity,
  title: Schema.optional(Schema.String),
  message: Schema.String,
  help: Schema.String,
  url: Schema.optional(Schema.String),
  line: Schema.Number,
  column: Schema.Number,
  offset: Schema.optional(Schema.Number),
  length: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  category: Schema.String,
  matchByOccurrence: Schema.optional(Schema.Boolean),
  fileContext: Schema.optional(Schema.Literals(["test", "story"])),
  suppressionHint: Schema.optional(Schema.String),
  relatedLocations: Schema.optional(Schema.Array(DiagnosticRelatedLocation)),
  fixGroupId: Schema.optional(Schema.String),
}) {}

export class JsonReportDiagnosticV3 extends Schema.Class<JsonReportDiagnosticV3>(
  "JsonReportDiagnosticV3",
)({
  id: Schema.String,
  normalizedFilePath: Schema.String,
  filePath: Schema.String,
  plugin: Schema.String,
  rule: Schema.String,
  severity: Severity,
  tags: Schema.Array(Schema.String),
  title: Schema.optional(Schema.String),
  message: Schema.String,
  help: Schema.String,
  url: Schema.optional(Schema.String),
  line: Schema.Number,
  column: Schema.Number,
  offset: Schema.optional(Schema.Number),
  length: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  category: Schema.String,
  matchByOccurrence: Schema.optional(Schema.Boolean),
  fileContext: Schema.optional(Schema.Literals(["test", "story"])),
  suppressionHint: Schema.optional(Schema.String),
  relatedLocations: Schema.optional(Schema.Array(DiagnosticRelatedLocation)),
  fixGroupId: Schema.optional(Schema.String),
}) {}

/**
 * Deterministic identity string for a diagnostic. Same diagnostic
 * across two scans yields the same identity; lets baselines,
 * suppression files, content-hash caches, and IDE "ignore this"
 * actions all key off one shared shape.
 */
export const buildDiagnosticIdentity = (input: {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly plugin: string;
  readonly rule: string;
}): string => `${input.filePath}::${input.line}:${input.column}::${input.plugin}/${input.rule}`;

export const JsonReportMode = Schema.Literals(["full", "diff", "staged", "baseline"]);
export type JsonReportMode = Schema.Schema.Type<typeof JsonReportMode>;

export const Framework = Schema.Literals(FRAMEWORK_TOKENS);

export class JsonReportSummary extends Schema.Class<JsonReportSummary>("JsonReportSummary")({
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  affectedFileCount: Schema.Number,
  totalDiagnosticCount: Schema.Number,
  score: Schema.NullOr(Schema.Number),
  scoreLabel: Schema.NullOr(Schema.String),
}) {}

export class JsonReportDiffInfo extends Schema.Class<JsonReportDiffInfo>("JsonReportDiffInfo")({
  baseBranch: Schema.String,
  currentBranch: Schema.NullOr(Schema.String),
  changedFileCount: Schema.Number,
  isCurrentChanges: Schema.Boolean,
}) {}

export class JsonReportError extends Schema.Class<JsonReportError>("JsonReportError")({
  message: Schema.String,
  name: Schema.String,
  chain: Schema.Array(Schema.String),
  /** Sentry event id for the crash, when one was reported. */
  sentryEventId: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/**
 * Schema for a single project entry within a JsonReport. `project` is
 * `Schema.Unknown` for now because `ProjectInfo` is still a hand-written
 * interface in `@react-doctor/core`; it gets a real schema when the
 * `Project` service lands and at that point this field tightens.
 */
export class JsonReportProjectEntry extends Schema.Class<JsonReportProjectEntry>(
  "JsonReportProjectEntry",
)({
  directory: Schema.String,
  project: Schema.Unknown,
  diagnostics: Schema.Array(Diagnostic),
  score: Schema.Unknown,
  skippedChecks: Schema.Array(Schema.String),
  skippedCheckReasons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  scannedFileCount: Schema.optional(Schema.Number),
  elapsedMilliseconds: Schema.Number,
}) {}

export class JsonReportProjectEntryV3 extends Schema.Class<JsonReportProjectEntryV3>(
  "JsonReportProjectEntryV3",
)({
  directory: Schema.String,
  packageRoot: Schema.String,
  framework: Framework,
  project: Schema.Unknown,
  diagnostics: Schema.Array(JsonReportDiagnosticV3),
  score: Schema.Unknown,
  skippedChecks: Schema.Array(Schema.String),
  skippedCheckReasons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  analyzedFiles: Schema.Array(Schema.String),
  analyzedFileCount: Schema.Number,
  complete: Schema.Boolean,
  scannedFileCount: Schema.optional(Schema.Number),
  elapsedMilliseconds: Schema.Number,
}) {}

/** Original full, diff, and staged report contract. */
export class JsonReportV1 extends Schema.Class<JsonReportV1>("JsonReportV1")({
  schemaVersion: Schema.Literal(1),
  version: Schema.String,
  ok: Schema.Boolean,
  directory: Schema.String,
  mode: JsonReportMode,
  /**
   * True when a `changed` (compare) run was intended but the base couldn't be
   * resolved — a shallow CI checkout with no merge base, or a failed base/head
   * lint. The report then lists every finding in the changed files (mode
   * downgrades to `diff`, the `baseline` block is dropped, the CI gate is
   * skipped) rather than only the ones the change introduced. Absent on a
   * successful `baseline` run (`schemaVersion: 2`) and on non-compare scopes.
   */
  baselineDegraded: Schema.optional(Schema.Boolean),
  /**
   * Whether any scanned project resolved a React-compatible runtime (React
   * or Preact). `false` means every React-runtime rule family was gated off,
   * so an empty `diagnostics` array is vacuous — NOT the same as a clean
   * React scan. Consumers gating on the report (CI, verifiers, hooks) should
   * treat `reactDetected === false` as "wrong scan target", not "all clear".
   * Absent when nothing was scanned (`projects` is empty), on error reports,
   * and on reports from older CLI versions.
   */
  reactDetected: Schema.optional(Schema.Boolean),
  diff: Schema.NullOr(JsonReportDiffInfo),
  projects: Schema.Array(JsonReportProjectEntry),
  diagnostics: Schema.Array(Diagnostic),
  summary: JsonReportSummary,
  elapsedMilliseconds: Schema.Number,
  error: Schema.NullOr(JsonReportError),
}) {}

export class JsonReportBaseline extends Schema.Class<JsonReportBaseline>("JsonReportBaseline")({
  baseRef: Schema.String,
  newCount: Schema.Number,
  fixedCount: Schema.Number,
  baseTotalCount: Schema.Number,
}) {}

/**
 * Baseline (PR-introduced-issues-only) report — `schemaVersion: 2`. A
 * superset of v1: same fields, plus a `baseline` block. `diagnostics` /
 * `summary` counts are the introduced findings only; `summary.score` stays
 * the head project-health score. Consumers branch on `schemaVersion`.
 */
export class JsonReportV2 extends Schema.Class<JsonReportV2>("JsonReportV2")({
  schemaVersion: Schema.Literal(2),
  version: Schema.String,
  ok: Schema.Boolean,
  directory: Schema.String,
  mode: JsonReportMode,
  /** See `JsonReportV1.reactDetected`. */
  reactDetected: Schema.optional(Schema.Boolean),
  diff: Schema.NullOr(JsonReportDiffInfo),
  baseline: JsonReportBaseline,
  projects: Schema.Array(JsonReportProjectEntry),
  diagnostics: Schema.Array(Diagnostic),
  summary: JsonReportSummary,
  elapsedMilliseconds: Schema.Number,
  error: Schema.NullOr(JsonReportError),
}) {}

export class JsonReportV3 extends Schema.Class<JsonReportV3>("JsonReportV3")({
  schemaVersion: Schema.Literal(3),
  version: Schema.String,
  ok: Schema.Boolean,
  directory: Schema.String,
  mode: JsonReportMode,
  baselineDegraded: Schema.optional(Schema.Boolean),
  reactDetected: Schema.optional(Schema.Boolean),
  diff: Schema.NullOr(JsonReportDiffInfo),
  baseline: Schema.optional(JsonReportBaseline),
  projects: Schema.Array(JsonReportProjectEntryV3),
  diagnostics: Schema.Array(JsonReportDiagnosticV3),
  summary: JsonReportSummary,
  elapsedMilliseconds: Schema.Number,
  error: Schema.NullOr(JsonReportError),
}) {}

export const JsonReport = Schema.Union([JsonReportV1, JsonReportV2, JsonReportV3]);
export type JsonReport = Schema.Schema.Type<typeof JsonReport>;
