export interface CorpusRepository {
  name: string;
  slug: string;
  url: string;
  sha: string;
  subdirectory?: string;
}

export interface RepositoryAuditResult {
  repo: string;
  sha: string;
  ruleCounts: Record<string, number>;
}

export interface DeltaAuditResults {
  generatedAt: string;
  cliVersion: string;
  repositories: RepositoryAuditResult[];
}

export const GIT_CLONE_TIMEOUT_MS = 300_000;
export const SCAN_TIMEOUT_MS = 600_000;
export const SCAN_MAX_ATTEMPTS = 2;
export const COMMAND_MAX_BUFFER_BYTES = 100_000_000;
export const TEMP_DIR_PREFIX = "react-doctor-delta-audit-";

export const DEAD_RULE_BASELINE_MIN_FINDINGS = 5;
export const COUNT_CHANGE_ALERT_RATIO = 3;
export const COUNT_CHANGE_ALERT_MIN_ABSOLUTE_DELTA = 20;
