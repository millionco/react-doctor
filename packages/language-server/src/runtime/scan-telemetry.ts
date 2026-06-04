import type { ScanOutcome, Telemetry, WorkspaceScanTrigger } from "../types.js";

interface ActiveBurst {
  readonly trigger: WorkspaceScanTrigger;
  readonly startedAtEpochMs: number;
  readonly projectCount: number;
  chunkCount: number;
  filesWithDiagnostics: number;
  totalDiagnostics: number;
  errorCount: number;
  warningCount: number;
  readonly diagnosticsByCategory: Map<string, number>;
  lintDegraded: boolean;
  lintIncompleteChunks: number;
}

/**
 * Accumulates the background scan chunks of one workspace-scan burst into a
 * single aggregate, then hands it to {@link Telemetry.recordWorkspaceScan} as
 * the canonical per-scan "wide event". The server drives the lifecycle:
 * `begin` when a workspace scan is kicked off, `accumulate` for each completed
 * background outcome, and `finish` when the scheduler next goes idle.
 *
 * Interactive / save scans are never folded in (the server only calls
 * `accumulate` for `background` outcomes), so the event reflects the workspace
 * audit rather than per-keystroke activity.
 */
export interface ScanTelemetry {
  /** Start a burst, discarding any prior partial (e.g. a rescan supersedes it). */
  readonly begin: (trigger: WorkspaceScanTrigger, projectCount: number) => void;
  /** Fold one completed background scan outcome into the active burst. */
  readonly accumulate: (outcome: ScanOutcome) => void;
  /** Emit the active burst's wide event (when it scanned anything) and reset. */
  readonly finish: () => void;
}

export const createScanTelemetry = (
  telemetry: Telemetry,
  now: () => number = Date.now,
): ScanTelemetry => {
  let active: ActiveBurst | null = null;

  const begin = (trigger: WorkspaceScanTrigger, projectCount: number): void => {
    active = {
      trigger,
      startedAtEpochMs: now(),
      projectCount,
      chunkCount: 0,
      filesWithDiagnostics: 0,
      totalDiagnostics: 0,
      errorCount: 0,
      warningCount: 0,
      diagnosticsByCategory: new Map(),
      lintDegraded: false,
      lintIncompleteChunks: 0,
    };
  };

  const accumulate = (outcome: ScanOutcome): void => {
    if (!active) return;
    active.chunkCount += 1;
    if (outcome.didLintFail) active.lintDegraded = true;
    if (outcome.lintIncomplete) active.lintIncompleteChunks += 1;
    for (const diagnostics of outcome.byFile.values()) {
      if (diagnostics.length > 0) active.filesWithDiagnostics += 1;
      for (const diagnostic of diagnostics) {
        active.totalDiagnostics += 1;
        if (diagnostic.severity === "error") active.errorCount += 1;
        else active.warningCount += 1;
        active.diagnosticsByCategory.set(
          diagnostic.category,
          (active.diagnosticsByCategory.get(diagnostic.category) ?? 0) + 1,
        );
      }
    }
  };

  const finish = (): void => {
    const burst = active;
    active = null;
    // Skip bursts that never scanned anything (empty workspace, or every chunk
    // cancelled before completing) — a zero-chunk event is noise, not signal.
    if (!burst || burst.chunkCount === 0) return;
    telemetry.recordWorkspaceScan({
      trigger: burst.trigger,
      startedAtEpochMs: burst.startedAtEpochMs,
      durationMs: Math.max(0, now() - burst.startedAtEpochMs),
      projectCount: burst.projectCount,
      chunkCount: burst.chunkCount,
      filesWithDiagnostics: burst.filesWithDiagnostics,
      totalDiagnostics: burst.totalDiagnostics,
      errorCount: burst.errorCount,
      warningCount: burst.warningCount,
      diagnosticsByCategory: Object.fromEntries(burst.diagnosticsByCategory),
      lintDegraded: burst.lintDegraded,
      lintIncompleteChunks: burst.lintIncompleteChunks,
    });
  };

  return { begin, accumulate, finish };
};
