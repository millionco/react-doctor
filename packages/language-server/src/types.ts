import type { Diagnostic as CoreDiagnostic, ProjectInfo } from "@react-doctor/core";

/**
 * Minimal logging seam so modules don't depend on the LSP connection
 * directly. The server wires this to `window/logMessage`; tests pass a
 * silent or recording logger.
 */
export interface Logger {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
}

export const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** What kicked off a workspace-scan burst (the wide-event's `trigger`). */
export type WorkspaceScanTrigger =
  | "initial"
  | "config-change"
  | "workspace-folders-change"
  | "manual"
  | "restart";

/** One-shot session analytics, emitted once after the server initializes. */
export interface SessionTelemetry {
  readonly serverVersion: string;
  readonly nodeMajor: number;
  readonly projectCount: number;
  readonly workspaceFolderCount: number;
  readonly scanOnType: boolean;
  /** Whether a Node binary able to load the oxlint native binding was found. */
  readonly lintAvailable: boolean;
}

/**
 * Aggregate outcome of one workspace-scan burst — the unit the editor
 * telemetry treats as a "scan" (analogous to one CLI run). Per-keystroke
 * interactive scans are deliberately excluded; only the background workspace
 * audit (initial, config/folder change, manual, restart) is reported.
 */
export interface WorkspaceScanTelemetry {
  readonly trigger: WorkspaceScanTrigger;
  /** Epoch ms when the burst began (the wide-event span's start time). */
  readonly startedAtEpochMs: number;
  readonly durationMs: number;
  readonly projectCount: number;
  /** Completed background scan chunks aggregated into this burst. */
  readonly chunkCount: number;
  readonly filesWithDiagnostics: number;
  readonly totalDiagnostics: number;
  readonly errorCount: number;
  readonly warningCount: number;
  /** Diagnostic counts keyed by rule category (e.g. "Performance"). */
  readonly diagnosticsByCategory: Readonly<Record<string, number>>;
  /** `true` when any chunk reported lint as degraded/unavailable. */
  readonly lintDegraded: boolean;
  /** Chunks that linted only partially (some files failed within the batch). */
  readonly lintIncompleteChunks: number;
}

/**
 * Telemetry seam so the server reports analytics without depending on a
 * concrete backend (mirrors the {@link Logger} seam). The published CLI
 * injects a Sentry-backed implementation (wide-event spans + counters);
 * tests and direct `startLanguageServer()` callers get {@link NOOP_TELEMETRY}.
 */
export interface Telemetry {
  /** Once per session, after the project graph is first available. */
  readonly recordSessionStart: (session: SessionTelemetry) => void;
  /** Once per completed workspace-scan burst (the canonical wide event). */
  readonly recordWorkspaceScan: (scan: WorkspaceScanTelemetry) => void;
  /** Best-effort flush of queued telemetry before the server exits. */
  readonly flush?: () => Promise<void>;
}

export const NOOP_TELEMETRY: Telemetry = {
  recordSessionStart: () => {},
  recordWorkspaceScan: () => {},
};

/**
 * A React project discovered in the workspace. `directory` is an
 * absolute, normalized (forward-slash) path to the project root.
 */
export interface WorkspaceProject {
  readonly directory: string;
  readonly name: string;
}

/**
 * Resolves which project owns a file and enumerates workspace projects.
 * Backed by `@react-doctor/core`'s discovery helpers, with caching and
 * explicit invalidation when watched config files change.
 */
export interface ProjectGraph {
  /** All React projects discovered across the workspace roots. */
  readonly listProjects: () => ReadonlyArray<WorkspaceProject>;
  /**
   * Deepest project directory that owns `absoluteFilePath`, or `null`
   * when the file is outside every known React project.
   */
  readonly resolveOwningProject: (absoluteFilePath: string) => string | null;
  /** Re-discovers projects from the workspace roots (after config changes). */
  readonly refresh: () => void;
  /** Drops cached project/config state for incremental correctness. */
  readonly invalidate: () => void;
}

/** Priority class for a queued scan; drives ordering and debounce. */
export type ScanPriority = "interactive" | "save" | "background";

/** A scan to perform, before the scheduler assigns it a generation id. */
export interface ScanRequestInput {
  readonly priority: ScanPriority;
  /** Absolute, normalized project root the scan targets. */
  readonly projectDirectory: string;
  /**
   * Absolute file paths to lint. Empty → whole-project scan (covers the
   * project, enabling stale-diagnostic cleanup for that project).
   */
  readonly files: ReadonlyArray<string>;
  /** Whether to run dead-code analysis (whole-project background scans). */
  readonly runDeadCode: boolean;
  /** Use in-memory buffer overlays for the target files (unsaved edits). */
  readonly useOverlay: boolean;
  /** Short human-readable cause, for log lines. */
  readonly reason: string;
}

/** A scan request with its monotonic generation id assigned. */
export interface ScanRequest extends ScanRequestInput {
  readonly id: number;
}

/**
 * Cancellation signal handed to `performScan`. Reflects whether a newer
 * generation has superseded this scan's queue key; the scheduler also
 * drops superseded results so a slow oxlint subprocess can't clobber a
 * fresher one.
 */
export interface CancellationToken {
  readonly isCancelled: boolean;
}

/** Diagnostics produced by one scan, grouped by absolute file path. */
export interface ScanOutcome {
  readonly request: ScanRequest;
  readonly ok: boolean;
  readonly skipped: boolean;
  /** Absolute fs path → core diagnostics for that file. */
  readonly byFile: ReadonlyMap<string, ReadonlyArray<CoreDiagnostic>>;
  /**
   * `true` when this scan covered the whole project, so the publisher
   * may clear previously-published files in the project that are absent
   * from `byFile`.
   */
  readonly coversProject: boolean;
  /** Absolute files explicitly requested (cleared when absent from `byFile`). */
  readonly requestedPaths: ReadonlyArray<string>;
  readonly project: ProjectInfo | null;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  /**
   * `true` when lint ran but some files failed within the batch (partial
   * failure). Like `didLintFail`, it marks the result unreliable so the
   * publisher won't clear diagnostics for files that weren't linted.
   */
  readonly lintIncomplete?: boolean;
  readonly error: string | null;
}

/** Performs a single scan. Implemented by the scan runner. */
export type PerformScan = (
  request: ScanRequest,
  token: CancellationToken,
) => Promise<ScanOutcome | null>;

export interface SchedulerOptions {
  readonly performScan: PerformScan;
  readonly onResult: (outcome: ScanOutcome) => void;
  readonly onError?: (error: unknown, request: ScanRequest) => void;
  readonly onIdleChange?: (isIdle: boolean) => void;
  readonly debounceMs?: number;
  readonly concurrency?: number;
  /**
   * Slots kept free from `background` scans so an `interactive` / `save`
   * scan can always start immediately, even while a large workspace scan
   * is in flight. Background scans run with at most
   * `concurrency - reservedInteractiveSlots` parallelism. Defaults to 0.
   */
  readonly reservedInteractiveSlots?: number;
  readonly logger?: Logger;
}

export interface Scheduler {
  /** Queue a scan, coalescing with any pending scan for the same target. */
  readonly enqueue: (request: ScanRequestInput) => void;
  /** Cancel all pending + in-flight scans for a project (e.g. on close). */
  readonly cancelProject: (projectDirectory: string) => void;
  /** Number of scans currently queued or running (for tests / status). */
  readonly pendingCount: () => number;
  readonly dispose: () => void;
}

/**
 * Structured payload attached to every published LSP diagnostic's
 * `data` field. Lets hover / code-action / command handlers operate on a
 * diagnostic the client echoes back without re-deriving anything.
 */
export interface ReactDoctorDiagnosticData {
  readonly identity: string;
  readonly plugin: string;
  readonly rule: string;
  readonly ruleId: string;
  readonly category: string;
  readonly help: string;
  readonly url: string | null;
  readonly suppressionHint: string | null;
  /** 1-indexed source line of the primary span (from the engine). */
  readonly line: number;
  /** 1-indexed source column of the primary span. */
  readonly column: number;
  readonly fsPath: string;
}

/** Reads the current text of a file (open buffer or disk), or `null`. */
export type TextProvider = (absoluteFilePath: string) => string | null;
