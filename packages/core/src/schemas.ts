import * as Schema from "effect/Schema";

export const Severity = Schema.Literals(["error", "warning"]);
export type Severity = Schema.Schema.Type<typeof Severity>;

export class Diagnostic extends Schema.Class<Diagnostic>("Diagnostic")({
  filePath: Schema.String,
  plugin: Schema.String,
  rule: Schema.String,
  severity: Severity,
  message: Schema.String,
  help: Schema.String,
  url: Schema.optional(Schema.String),
  line: Schema.Number,
  column: Schema.Number,
  category: Schema.String,
  suppressionHint: Schema.optional(Schema.String),
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

export const JsonReportMode = Schema.Literals(["full", "diff", "staged"]);
export type JsonReportMode = Schema.Schema.Type<typeof JsonReportMode>;

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
  elapsedMilliseconds: Schema.Number,
}) {}

/**
 * Versioned JsonReport schema. `JsonReport` is a `Schema.Union` so we
 * can add `schemaVersion: 2` later as one new union member without
 * breaking existing v1 consumers (the GitHub Action keys off the
 * version literal). Today's union is single-arm; the shape is
 * intentional.
 */
export class JsonReportV1 extends Schema.Class<JsonReportV1>("JsonReportV1")({
  schemaVersion: Schema.Literal(1),
  version: Schema.String,
  ok: Schema.Boolean,
  directory: Schema.String,
  mode: JsonReportMode,
  diff: Schema.NullOr(JsonReportDiffInfo),
  projects: Schema.Array(JsonReportProjectEntry),
  diagnostics: Schema.Array(Diagnostic),
  summary: JsonReportSummary,
  elapsedMilliseconds: Schema.Number,
  error: Schema.NullOr(JsonReportError),
}) {}

export const JsonReport = Schema.Union([JsonReportV1]);
export type JsonReport = Schema.Schema.Type<typeof JsonReport>;
