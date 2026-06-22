import {
  calculateScore,
  filterDiagnosticsForSurface,
  type Diagnostic,
  type ReactDoctorConfig,
  type ScoreResult,
} from "@react-doctor/core";
import {
  STATS_MIN_FILES_FOR_SCORE,
  STATS_SCORE_PRIOR_FILES,
  STATS_SCORE_SESSION_FLOOR,
  STATS_SCORE_SESSION_PRIOR,
  STATS_TOP_RULES_PER_GROUP,
} from "./constants.js";
import type { GroupStats, SessionScanResult, StatsProvider } from "./types.js";

/** Computes a 0-100 score for a diagnostic set. Injectable for tests. */
export type ScoreComputer = (
  diagnostics: Diagnostic[],
  sourceFileCount: number,
) => Promise<ScoreResult | null>;

const defaultScoreComputer: ScoreComputer = (diagnostics, sourceFileCount) =>
  calculateScore(diagnostics, { metadata: { sourceFileCount } });

interface Accumulator {
  readonly key: string;
  readonly provider: StatsProvider | "mixed";
  sessions: number;
  filesScanned: number;
  unreconstructable: number;
  diagnostics: Diagnostic[];
}

const upsert = (
  groups: Map<string, Accumulator>,
  key: string,
  provider: StatsProvider | "mixed",
  result: SessionScanResult,
): void => {
  let group = groups.get(key);
  if (!group) {
    group = { key, provider, sessions: 0, filesScanned: 0, unreconstructable: 0, diagnostics: [] };
    groups.set(key, group);
  }
  group.sessions += 1;
  group.filesScanned += result.filesScanned;
  group.unreconstructable += result.unreconstructable;
  group.diagnostics.push(...result.diagnostics);
};

/**
 * Confidence-weight a raw score with a Bayesian average: pull it toward the
 * global mean (`priorScore`) by the group's evidence. Files are the dominant
 * sample unit; sessions only lightly discount the file weight (many files from
 * one session are one correlated sample), bounded below by a floor so a
 * file-rich, session-poor group still counts. Low-evidence groups regress to the
 * mean; high-evidence groups keep their raw score. Returns the raw score when
 * there's no prior.
 */
export const confidenceWeightedScore = (
  rawScore: number | null,
  priorScore: number | null,
  filesScanned: number,
  sessions: number,
): number | null => {
  if (rawScore === null) return null;
  if (priorScore === null) return rawScore;
  const sessionReliability =
    STATS_SCORE_SESSION_FLOOR +
    (1 - STATS_SCORE_SESSION_FLOOR) * (sessions / (sessions + STATS_SCORE_SESSION_PRIOR));
  const effectiveFiles = filesScanned * sessionReliability;
  return Math.round(
    (priorScore * STATS_SCORE_PRIOR_FILES + rawScore * effectiveFiles) /
      (STATS_SCORE_PRIOR_FILES + effectiveFiles),
  );
};

const topRules = (diagnostics: ReadonlyArray<Diagnostic>): GroupStats["topRules"] => {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    counts.set(ruleKey, (counts.get(ruleKey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, STATS_TOP_RULES_PER_GROUP)
    .map(([rule, count]) => ({ rule, count }));
};

const toGroupStats = async (
  accumulator: Accumulator,
  userConfig: ReactDoctorConfig | null,
  computeScore: ScoreComputer,
  priorScore: number | null,
): Promise<GroupStats> => {
  const errorCount = accumulator.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const scoreEligible = accumulator.filesScanned >= STATS_MIN_FILES_FOR_SCORE;
  const score = scoreEligible
    ? await computeScore(
        filterDiagnosticsForSurface(accumulator.diagnostics, "score", userConfig),
        accumulator.filesScanned,
      )
    : null;
  const rawScore = score?.score ?? null;

  return {
    key: accumulator.key,
    provider: accumulator.provider,
    sessions: accumulator.sessions,
    filesScanned: accumulator.filesScanned,
    unreconstructable: accumulator.unreconstructable,
    totalDiagnostics: accumulator.diagnostics.length,
    errorCount,
    warningCount: accumulator.diagnostics.length - errorCount,
    diagnosticsPerFile:
      accumulator.filesScanned > 0 ? accumulator.diagnostics.length / accumulator.filesScanned : 0,
    score: rawScore,
    scoreLabel: score?.label ?? null,
    weightedScore: confidenceWeightedScore(
      rawScore,
      priorScore,
      accumulator.filesScanned,
      accumulator.sessions,
    ),
    topRules: topRules(accumulator.diagnostics),
  };
};

/**
 * Rank groups best-first by the confidence-weighted score; ties (and score-less
 * groups) break on fewer diagnostics-per-file. Only groups with enough scanned
 * files to be ranked fairly are returned.
 */
const rankGroups = (groups: ReadonlyArray<GroupStats>): GroupStats[] =>
  [...groups]
    .filter((group) => group.filesScanned >= STATS_MIN_FILES_FOR_SCORE)
    .sort((left, right) => {
      if (
        left.weightedScore !== null &&
        right.weightedScore !== null &&
        left.weightedScore !== right.weightedScore
      ) {
        return right.weightedScore - left.weightedScore;
      }
      if (left.weightedScore !== null && right.weightedScore === null) return -1;
      if (left.weightedScore === null && right.weightedScore !== null) return 1;
      return left.diagnosticsPerFile - right.diagnosticsPerFile;
    });

export interface AggregatedStats {
  readonly models: GroupStats[];
  readonly providers: GroupStats[];
  readonly best: GroupStats | null;
  readonly worst: GroupStats | null;
}

/**
 * Group scan results by model and by provider, compute a 0-100 score per group
 * (one Score API call each), and rank them into a leaderboard.
 */
export const aggregateStats = async (
  results: ReadonlyArray<SessionScanResult>,
  userConfig: ReactDoctorConfig | null,
  computeScore: ScoreComputer = defaultScoreComputer,
): Promise<AggregatedStats> => {
  const modelGroups = new Map<string, Accumulator>();
  const providerGroups = new Map<string, Accumulator>();
  for (const result of results) {
    upsert(
      modelGroups,
      `${result.session.provider}/${result.session.model}`,
      result.session.provider,
      result,
    );
    upsert(providerGroups, result.session.provider, result.session.provider, result);
  }

  // Global mean across every scanned file — the prior every group regresses
  // toward, so a small sample can't top the board on a lucky run.
  const totalFiles = results.reduce((sum, result) => sum + result.filesScanned, 0);
  const priorScore =
    totalFiles >= STATS_MIN_FILES_FOR_SCORE
      ? ((
          await computeScore(
            filterDiagnosticsForSurface(
              results.flatMap((result) => result.diagnostics),
              "score",
              userConfig,
            ),
            totalFiles,
          )
        )?.score ?? null)
      : null;

  const models = await Promise.all(
    [...modelGroups.values()].map((group) =>
      toGroupStats(group, userConfig, computeScore, priorScore),
    ),
  );
  const providers = await Promise.all(
    [...providerGroups.values()].map((group) =>
      toGroupStats(group, userConfig, computeScore, priorScore),
    ),
  );

  const rankedModels = rankGroups(models);
  return {
    models: rankedModels,
    providers: rankGroups(providers),
    best: rankedModels[0] ?? null,
    worst: rankedModels.length > 1 ? rankedModels[rankedModels.length - 1] : null,
  };
};
