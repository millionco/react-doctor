// HACK: Commander leaves boolean flags as `undefined` when not passed (rather
// than defaulting to `false`), so every "is the flag a real boolean?" field
// is optional here. The resolvers use that to distinguish "user passed
// nothing" from "user passed a value" without consulting `program`.
export interface InspectFlags {
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  // Forces a Sentry trace and prints its id at the end. Conflicts with
  // --no-score / --no-telemetry, which disable the telemetry it needs.
  debug?: boolean;
  outputDir?: string;
  score?: boolean;
  json?: boolean;
  jsonCompact?: boolean;
  telemetry?: boolean;
  yes?: boolean;
  staged?: boolean;
  // Commander's `--no-respect-inline-disables` negatable option: defaults to
  // `true` and flips to `false` only when the user passes the flag. The
  // resolver maps the `true` default back to `undefined` so config can win.
  respectInlineDisables?: boolean;
  warnings?: boolean;
  category?: string | string[];
  project?: string;
  scope?: string;
  base?: string;
  // Deprecated alias for `--scope` (warns at runtime); resolved by resolveScope.
  diff?: boolean | string;
  changedFilesFrom?: string;
  // Commander's `--no-parallel` negatable option: defaults to `true`
  // (parallel) and flips to `false` only when the user passes the flag.
  parallel?: boolean;
  // Set by the `why <file:line>` command (no longer a CLI flag); routes the
  // inspect flow into the single-location explain path.
  explain?: string;
  blocking?: string;
  /**
   * @deprecated Renamed to `blocking`. Still parsed as an alias when
   * `blocking` is unset, but triggers a one-time deprecation warning.
   */
  failOn?: string;
}
