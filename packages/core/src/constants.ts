// SOURCE_FILE_PATTERN, GIT_LS_FILES_MAX_BUFFER_BYTES, and
// IGNORED_DIRECTORIES live in `./project-info/constants.js`
// (the project-discovery subtree). Re-exported here so core
// consumers don't have to know which subtree owns each constant.
export {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  SOURCE_FILE_PATTERN,
} from "./project-info/constants.js";

export const JSX_FILE_PATTERN = /\.(tsx|jsx)$/;

export const MILLISECONDS_PER_SECOND = 1000;

export const ERROR_PREVIEW_LENGTH_CHARS = 200;

export const PERFECT_SCORE = 100;

export const SCORE_GOOD_THRESHOLD = 75;

export const SCORE_OK_THRESHOLD = 50;

export const SCORE_BAR_WIDTH_CHARS = 50;

export const SCORE_API_URL = "https://www.react.doctor/api/score";

export const SHARE_BASE_URL = "https://www.react.doctor/share";

export const FETCH_TIMEOUT_MS = 10_000;

// HACK: Windows CreateProcessW limits total command-line length to 32,767 chars.
// Use a conservative threshold to leave room for the executable path and quoting overhead.
export const SPAWN_ARGS_MAX_LENGTH_CHARS = 24_000;

// HACK: bound per-batch work so that JS-evaluated plugins with bad
// scaling (originally the upstream `effect` plugin — verified to hit
// the 5-min spawn timeout on supabase/studio's ~3500 source files at
// batch=500, productive at batch=100; same characteristics apply to
// the ported `react-doctor/no-derived-state` family because both rely
// on whole-component scope walking) stay tractable AND so that oxlint
// doesn't SIGABRT from memory pressure on very large file sets.
// Smaller batches add ~50ms spawn overhead per extra batch — negligible
// vs the hard-cap perf cliffs they prevent.
export const OXLINT_MAX_FILES_PER_BATCH = 100;

export const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

// JSON-format oxlint / eslint configs react-doctor can fold into the
// scan via oxlint's `extends` field. JS / TS configs need a runtime
// to evaluate and aren't supported by oxlint's `extends`. Listed in
// detection priority order — oxlint native first, eslint legacy as a
// compatibility fallback. Also used by tests as the source of truth.
export const ADOPTABLE_LINT_CONFIG_FILENAMES = [".oxlintrc.json", ".eslintrc.json"];

export const OXLINT_NODE_REQUIREMENT = "^20.19.0 || >=22.12.0";

export const OXLINT_RECOMMENDED_NODE_MAJOR = 24;

export const GIT_SHOW_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Project-config files that `StagedFiles.materialize` copies into
 * the temp directory alongside staged sources so oxlint resolves
 * `tsconfig` / `package.json` / lint configs the same way it would
 * in the working tree. Hoisted out of the staged-files helper so
 * the constant lives next to the rest of the IO budget knobs.
 */
export const STAGED_FILES_PROJECT_CONFIG_FILENAMES = [
  "tsconfig.json",
  "tsconfig.base.json",
  "package.json",
  "react-doctor.config.json",
  "oxlint.json",
  ".oxlintrc.json",
] as const;

export const CANONICAL_GITHUB_URL = "https://github.com/millionco/react-doctor";

export const SKILL_NAME = "react-doctor";

// HACK: cap on combined stdout+stderr bytes per oxlint batch. Above
// this we kill the process (SIGKILL) and ask the user to narrow the
// scan with --diff. Pinned to 50 MiB because oxlint emits ~1 KB of
// JSON per diagnostic and the largest real-world batches in the eval
// corpus (supabase/studio at 3,567 source files) produce ~3 MiB
// total — 50 MiB leaves an order of magnitude of headroom for
// pathological JS-plugin rules that emit one diagnostic per AST node.
export const OXLINT_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

// HACK: per-batch wall-clock budget for an oxlint spawn. Each batch
// is at most OXLINT_MAX_FILES_PER_BATCH (= 100) files and a healthy
// batch finishes in well under a second; 60 s leaves a large safety
// margin while still firing fast enough that the binary-split
// recovery in spawnLintBatches narrows a pathological batch to the
// single offending file rather than killing the whole scan as the
// previous 5-min budget did on supabase/studio. The eval harness
// overrides this via the OxlintSpawnTimeoutMs Context.Reference when
// running under Vercel Sandbox microVMs where the oxlint native
// binding is markedly slower than on a developer laptop.
export const OXLINT_SPAWN_TIMEOUT_MS = 60_000;

// HACK: lookahead cap for JSX opener-span scanning; bounds worst-case
// work on pathological files. Real openers stay well under this.
export const JSX_OPENER_SCAN_MAX_LINES = 32;

// HACK: lookback cap for stacked / near-miss disable-next-line scanning.
// Larger gaps stop being intentional suppressions and become noise.
export const SUPPRESSION_NEAR_MISS_MAX_LINES = 10;

// In the default human output, show several category sections like an
// audit report, but cap each section so one noisy category does not
// bury the rest of the scan.
export const MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE = 5;

export const MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE = 3;

// Minimum width of the rule-name column in the diagnostics list. Pads
// shorter rule names so the right-aligned `N sites` count stays in a
// consistent column even when one rule has a much longer identifier.
export const RULE_NAME_COLUMN_WIDTH_CHARS = 36;

export const OUTPUT_DETAIL_WRAP_WIDTH_CHARS = 88;

export const SPINNER_INDENT_CHARS = 0;

// Defense-in-depth caps for user-supplied glob patterns. Picomatch
// itself is well-hardened against many bad inputs, but ALL glob →
// JavaScript regex compilers emit backtracking-prone output when fed
// densely interleaved wildcards (e.g. `a*a*a*a*…`). These limits
// reject obviously pathological inputs with a clear config error
// before any matcher compilation, bounding worst-case work even when
// the underlying engine is robust. The wildcard cap intentionally
// leaves headroom for realistic ignore patterns
// (e.g. `**/foo/**/bar/**/baz/**/*.tsx` has 9 wildcards) while
// rejecting deeply-stacked globstars and dense alternations.
export const MAX_GLOB_PATTERN_LENGTH_CHARS = 1024;

export const MAX_GLOB_PATTERN_WILDCARD_COUNT = 24;
