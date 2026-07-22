/** Display name used in client-facing messages and progress titles. */
export const SERVER_DISPLAY_NAME = "React Doctor";

/** Server version reported in `serverInfo`; injected at build, `dev` from source. */
export const SERVER_VERSION = process.env.VERSION ?? "0.0.0-dev";

/** `Diagnostic.source` shown next to every published diagnostic. */
export const DIAGNOSTIC_SOURCE = "react-doctor";

/**
 * Debounce window between an open document's last edit and the
 * overlay rescan it triggers. Long enough that fast typing collapses
 * into a single scan, short enough to still feel live.
 */
export const DOCUMENT_CHANGE_DEBOUNCE_MS = 300;

/**
 * Debounce before config / package / lockfile changes trigger a
 * workspace-wide cache invalidation + rescan. Coalesces the burst of
 * watcher events a single `pnpm install` or config edit produces.
 */
export const CONFIG_CHANGE_DEBOUNCE_MS = 500;

/** Delay after `initialized` before the first background workspace scan. */
export const INITIAL_WORKSPACE_SCAN_DELAY_MS = 300;

/**
 * Upper bound on parallel scans; effective concurrency is
 * `clamp(cpus, MIN, MAX)`. React Doctor's rules run as oxlint JS plugins
 * which are single-threaded per oxlint process, so the workspace scan
 * scales nearly linearly with the number of concurrent oxlint processes
 * (measured 3.4x going from 3 → 10 on a 10-core machine). The cap bounds
 * memory on very large machines (each oxlint process holds ASTs for its
 * batch).
 */
export const MAX_SCAN_CONCURRENCY = 16;

/** Lower bound so background chunks still parallelize on small machines. */
export const MIN_SCAN_CONCURRENCY = 2;

/** Scheduler slots kept free for interactive/save scans during a workspace scan. */
export const RESERVED_INTERACTIVE_SLOTS = 1;

/**
 * Source files per workspace-scan chunk. The workspace lint pass is split
 * into chunks of this size so it streams diagnostics progressively, runs
 * chunks in parallel, and is cancellable mid-scan (a config change or
 * shutdown drops the remaining chunks instead of waiting out one giant
 * non-cancellable oxlint run).
 *
 * Sized to match oxlint's internal `OXLINT_MAX_FILES_PER_BATCH` (100) so
 * each chunk is exactly one oxlint spawn. Smaller chunks load-balance
 * better across cores and reach first-diagnostics faster; measured best
 * total + lowest time-to-first-result at 100 on a 10-core machine.
 */
export const WORKSPACE_SCAN_CHUNK_SIZE = 100;

/**
 * On-disk lint-cache schema version. Bump to invalidate every persisted
 * cache after a format or diagnostic-semantics change.
 */
export const LINT_CACHE_VERSION = 3;

/**
 * Debounce before the in-memory lint cache is written to disk. A whole
 * workspace scan stores thousands of entries; debouncing collapses that
 * into a single write once the scan settles.
 */
export const LINT_CACHE_PERSIST_DEBOUNCE_MS = 2_000;

/**
 * Hex characters of the project-path hash used to name the lint cache file
 * in the temp-dir fallback (when a project has no `node_modules`). Long
 * enough to avoid collisions between projects, short enough for a tidy name.
 */
export const CACHE_FILENAME_HASH_LENGTH_CHARS = 16;

// ── Command identifiers ────────────────────────────────────────────
// Shared with the companion editor extension. Keep in sync with the
// extension's `package.json` `contributes.commands`.

export const COMMAND_SCAN_WORKSPACE = "react-doctor.scanWorkspace";
export const COMMAND_SCAN_FILE = "react-doctor.scanFile";
export const COMMAND_FIX_ALL = "react-doctor.fixAll";
export const COMMAND_EXPLAIN = "react-doctor.explain";
export const COMMAND_OPEN_DOCS = "react-doctor.openDocs";
export const COMMAND_SUPPRESS_LINE = "react-doctor.suppressLine";
export const COMMAND_REPORT_FALSE_POSITIVE = "react-doctor.reportFalsePositive";
export const COMMAND_RESTART = "react-doctor.restart";

/** Every command the server registers via `executeCommandProvider`. */
export const ALL_COMMANDS = [
  COMMAND_SCAN_WORKSPACE,
  COMMAND_SCAN_FILE,
  COMMAND_FIX_ALL,
  COMMAND_EXPLAIN,
  COMMAND_OPEN_DOCS,
  COMMAND_SUPPRESS_LINE,
  COMMAND_REPORT_FALSE_POSITIVE,
  COMMAND_RESTART,
] as const;

/** Canonical GitHub repository, used for "report false positive" links. */
export const CANONICAL_GITHUB_URL = "https://github.com/millionco/react-doctor";

/**
 * Source file extensions the server scans on open / change / save / watch.
 * Mirrors core's `SOURCE_FILE_PATTERN` — the set the workspace enumeration
 * and the CLI lint — so reactive (open/change) and proactive (workspace)
 * scanning cover exactly the same files.
 */
export const SCANNABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"] as const;

export { CONFIG_FINGERPRINT_FILENAMES as CONFIG_WATCH_FILENAMES } from "@react-doctor/core";
