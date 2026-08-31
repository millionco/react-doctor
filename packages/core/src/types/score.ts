import type { ProjectInfo } from "./project-info.js";
import type { Diagnostic, DiagnosticFileContext } from "./diagnostic.js";

export type RuleTier = "P0" | "P1" | "P2" | "P3";

export interface CalculateScoreOptions {
  isCi?: boolean;
  metadata?: ScoreRequestMetadata;
  ruleEvidence?: ReadonlyArray<ScoreRuleEvidence>;
}

export interface ScoreRuleEvidence {
  readonly schemaVersion: 1;
  readonly category: string;
  readonly fileContext: DiagnosticFileContext;
  readonly pattern: string;
  readonly plugin: string;
  readonly rule: string;
  readonly severity: Diagnostic["severity"];
  readonly tokenCount: number;
  readonly truncated: boolean;
}

export interface ScoreRequestMetadata {
  repo?: string;
  sha?: string;
  framework?: ProjectInfo["framework"];
  reactVersion?: string;
  sourceFileCount?: number;
  defaultBranch?: string;
  doctorVersion?: string;
  runId?: string;
  githubEventName?: string;
  githubActorAssociation?: string;
  githubViewerPermission?: string;
}

export interface RulePriority {
  // Intrinsic end-user value of the rule, 0-100, or null when the rule isn't
  // ranked yet. Higher = more worth fixing first.
  readonly priority: number | null;
  readonly tier: RuleTier;
}

export interface ScoreResult {
  score: number;
  label: string;
  // Per-rule priority returned by the score API, keyed by `<plugin>/<rule>`.
  // Present when the score API ranks the violated rules; used to order the
  // diagnostics dump most-valuable-first. Absent under `--no-score` or when the
  // API is unreachable, in which case rendering falls back to severity order.
  readonly rules?: Readonly<Record<string, RulePriority>>;
}
