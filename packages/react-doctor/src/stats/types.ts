import type { Diagnostic } from "@react-doctor/core";

export type StatsProvider = "claude" | "codex" | "cursor";

export type FileEditKind = "write" | "replace" | "patch" | "delete";

/**
 * One edit operation an agent performed on a file, normalized across
 * providers. `replace` carries `oldString`/`newString`; `patch` carries a raw
 * apply-patch envelope; `write` carries full `content`. `resultContent` is the
 * post-edit full file content when the transcript records it directly (Claude
 * tool results), which short-circuits replay reconstruction.
 */
export interface FileEdit {
  readonly kind: FileEditKind;
  readonly path: string;
  readonly content?: string;
  readonly oldString?: string;
  readonly newString?: string;
  readonly replaceAll?: boolean;
  readonly patch?: string;
  readonly resultContent?: string;
}

/** A file the agent read, captured as a reconstruction base for replay. */
export interface FileRead {
  readonly path: string;
  readonly content: string;
}

/** A single agent run (one model), normalized from one transcript. */
export interface AgentSession {
  readonly provider: StatsProvider;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly model: string;
  readonly cwd: string | null;
  readonly edits: FileEdit[];
  readonly reads: FileRead[];
}

/**
 * A discovered-but-not-yet-parsed session. Sources enumerate these cheaply so
 * scope/`--since`/`--limit` can be applied before the expensive `load()` runs
 * (a file read for transcript sources, a DB walk for the Cursor composer
 * source). `modifiedMs` is the sort + `--since` key (0 when unknown).
 */
export interface SessionCandidate {
  readonly provider: StatsProvider;
  readonly modifiedMs: number;
  load(): Promise<AgentSession | null>;
}

/** A faithfully reconstructed file as the model left it at session end. */
export interface ReconstructedContent {
  /** Absolute path the agent wrote to (used for attribution + display). */
  readonly absolutePath: string;
  readonly content: string;
}

/** A reconstructed file placed under a scan root, ready to materialize + lint. */
export interface ReconstructedFile extends ReconstructedContent {
  /** Path relative to the scan root, forward-slashed (temp-dir layout). */
  readonly relativePath: string;
}

export interface SessionReconstruction {
  readonly session: AgentSession;
  readonly files: ReconstructedContent[];
  /** Paths touched but not faithfully reconstructable (e.g. Codex shell edits). */
  readonly unreconstructable: string[];
}

export interface SessionScanResult {
  readonly session: AgentSession;
  readonly diagnostics: Diagnostic[];
  /** React files actually linted (the score's denominator for this session). */
  readonly filesScanned: number;
  /**
   * Lintable files faithfully reconstructed before the React filter. When this
   * is positive but `filesScanned` is 0, the session was skipped only because
   * none of its files were React — not because reconstruction failed.
   */
  readonly reconstructedFiles: number;
  /** Files edited without a faithful base (a genuine reconstruction gap). */
  readonly unreconstructable: number;
}

/** Aggregate stats for one leaderboard row (a model or a provider). */
export interface GroupStats {
  readonly key: string;
  readonly provider: StatsProvider | "mixed";
  readonly sessions: number;
  readonly filesScanned: number;
  readonly unreconstructable: number;
  readonly totalDiagnostics: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly diagnosticsPerFile: number;
  /** Raw 0-100 React Doctor score for this group's code (null if undersampled). */
  readonly score: number | null;
  readonly scoreLabel: string | null;
  /**
   * Confidence-weighted score: the raw score regressed toward the global mean by
   * the group's evidence (files discounted by sessions). This is what the
   * leaderboard ranks on, so small samples can't dominate.
   */
  readonly weightedScore: number | null;
  readonly topRules: ReadonlyArray<{ readonly rule: string; readonly count: number }>;
}

export interface StatsReport {
  readonly scope: "repo" | "global";
  readonly directory: string;
  readonly models: GroupStats[];
  readonly providers: GroupStats[];
  readonly best: GroupStats | null;
  readonly worst: GroupStats | null;
  /** Sessions with edits that were reconstructed and considered. */
  readonly sessionsAnalyzed: number;
  /** Sessions that contributed at least one React file to the ranking. */
  readonly sessionsRanked: number;
  /** Sessions reconstructed successfully but whose files were all non-React. */
  readonly sessionsNonReact: number;
  /** Sessions whose edits could not be faithfully reconstructed. */
  readonly sessionsUnreconstructable: number;
  readonly generatedAt: string;
}

export interface StatsScopeOptions {
  readonly global: boolean;
  readonly since?: Date;
  readonly limit: number;
  readonly provider?: StatsProvider;
}

/** One model's standing across every `react-doctor stats` run (the community). */
export interface CommunityModel {
  readonly model: string;
  readonly harness: string;
  /** Files-weighted mean score across all runs (null if undersampled globally). */
  readonly communityScore: number | null;
  /** Distinct runs that contributed this model — the sample size behind the score. */
  readonly runs: number;
  readonly files: number;
}

/**
 * The global agent leaderboard returned by `/api/stats` in exchange for a run's
 * rows — how these agents rank across everyone, so a local board reads in context.
 */
export interface CommunityLeaderboard {
  readonly generatedAt: string;
  readonly models: ReadonlyArray<CommunityModel>;
}
