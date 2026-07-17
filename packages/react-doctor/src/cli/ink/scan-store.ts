import type { Diagnostic, ScoreResult } from "@react-doctor/core";
// The live feed carries diagnostics exactly as `Reporter.emit` produces them
// (the schema class), which differs from the index `Diagnostic` type only in
// nested-array readonly-ness. The settled `report` keeps the index type.
import type { Diagnostic as LiveDiagnostic } from "@react-doctor/core/schemas";

import { TUI_LIVE_FEED_MAX_ENTRIES } from "../utils/constants.js";
import type { CliAgentId } from "../utils/launch-agent.js";

export type ScanPhase = "scanning" | "report" | "summary";

export interface TuiHandoffRequest {
  readonly agentId: CliAgentId;
  readonly prompt: string;
}

export interface ScanReport {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly projectedScore: number | null;
  readonly projectName: string;
  readonly rootDirectory: string;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
  readonly lintFailureReason?: string;
}

export interface MultiProjectSummary {
  readonly projects: ReadonlyArray<ScanReport>;
  readonly aggregateScore: ScoreResult | null;
  readonly projectedScore: number | null;
  readonly combinedDiagnostics: ReadonlyArray<Diagnostic>;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
  readonly projectName: string;
  readonly rootDirectory: string;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
  readonly lintFailureReason?: string;
}

export interface ScanStoreSnapshot {
  readonly phase: ScanPhase;
  readonly liveDiagnostics: ReadonlyArray<LiveDiagnostic>;
  readonly liveCount: number;
  readonly progress: string | null;
  readonly report: ScanReport | null;
  readonly summary: MultiProjectSummary | null;
}

export interface ScanStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ScanStoreSnapshot;
  readonly emitDiagnostic: (diagnostic: LiveDiagnostic) => void;
  readonly setProgress: (progress: string | null) => void;
  readonly setReport: (report: ScanReport) => void;
  readonly setSummary: (summary: MultiProjectSummary) => void;
}

const INITIAL_SNAPSHOT: ScanStoreSnapshot = {
  phase: "scanning",
  liveDiagnostics: [],
  liveCount: 0,
  progress: null,
  report: null,
  summary: null,
};

export const createScanStore = (): ScanStore => {
  let snapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  const commit = (next: ScanStoreSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    emitDiagnostic: (diagnostic) =>
      commit({
        ...snapshot,
        liveDiagnostics: [...snapshot.liveDiagnostics, diagnostic].slice(
          -TUI_LIVE_FEED_MAX_ENTRIES,
        ),
        liveCount: snapshot.liveCount + 1,
      }),
    setProgress: (progress) => commit({ ...snapshot, progress }),
    setReport: (report) => commit({ ...snapshot, report, phase: "report" }),
    setSummary: (summary) => commit({ ...snapshot, summary, phase: "summary" }),
  };
};
