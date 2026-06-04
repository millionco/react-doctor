// HACK: Commander leaves boolean flags as `undefined` when not passed (rather
// than defaulting to `false`), so every "is the flag a real boolean?" field
// is optional here. The resolvers use that to distinguish "user passed
// nothing" from "user passed a value" without consulting `program`.
export interface InspectFlags {
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  score?: boolean;
  json?: boolean;
  jsonCompact?: boolean;
  telemetry?: boolean;
  yes?: boolean;
  full?: boolean;
  annotations?: boolean;
  staged?: boolean;
  prComment?: boolean;
  respectInlineDisables?: boolean;
  warnings?: boolean;
  project?: string;
  diff?: boolean | string;
  changedFilesFrom?: string;
  // Commander's `--no-parallel` negatable option: defaults to `true`
  // (parallel) and flips to `false` only when the user passes the flag.
  parallel?: boolean;
  explain?: string;
  why?: string;
  failOn?: string;
}
