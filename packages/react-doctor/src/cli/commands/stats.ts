import * as path from "node:path";
import { resolveScanTarget, type ReactDoctorConfig } from "@react-doctor/core";
import { aggregateStats } from "../../stats/aggregate-stats.js";
import { STATS_DEFAULT_SESSION_LIMIT } from "../../stats/constants.js";
import { discoverSessions } from "../../stats/discover-sessions.js";
import { renderStatsReport } from "../../stats/render-stats.js";
import { runStatsScan } from "../../stats/run-stats-scan.js";
import type { StatsProvider, StatsReport, StatsScopeOptions } from "../../stats/types.js";
import { METRIC } from "../utils/constants.js";
import { recordCount } from "../utils/record-metric.js";
import { spinner } from "../utils/spinner.js";

export interface StatsFlags {
  global?: boolean;
  since?: string;
  limit?: string;
  provider?: string;
  json?: boolean;
  cwd?: string;
}

const VALID_PROVIDERS = new Set<StatsProvider>(["claude", "codex", "cursor"]);

const parseProvider = (value: string | undefined): StatsProvider | undefined => {
  if (value === undefined) return undefined;
  if (!VALID_PROVIDERS.has(value as StatsProvider)) {
    throw new Error(`Unknown provider "${value}". Expected one of: claude, codex, cursor.`);
  }
  return value as StatsProvider;
};

const parseSince = (value: string | undefined): Date | undefined => {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --since date "${value}". Use e.g. 2026-06-01.`);
  }
  return parsed;
};

const parseLimit = (value: string | undefined): number => {
  if (value === undefined) return STATS_DEFAULT_SESSION_LIMIT;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : STATS_DEFAULT_SESSION_LIMIT;
};

const resolveTarget = async (
  directory: string,
): Promise<{ root: string; userConfig: ReactDoctorConfig | null }> => {
  try {
    const target = await resolveScanTarget(directory);
    return { root: target.resolvedDirectory, userConfig: target.userConfig };
  } catch {
    return { root: path.resolve(directory), userConfig: null };
  }
};

export const statsAction = async (flags: StatsFlags): Promise<void> => {
  const directory = flags.cwd ?? process.cwd();
  const scope: StatsScopeOptions = {
    global: flags.global ?? false,
    since: parseSince(flags.since),
    limit: parseLimit(flags.limit),
    provider: parseProvider(flags.provider),
  };

  const { root, userConfig } = await resolveTarget(directory);

  // ora renders to stderr; suppress it in JSON mode so the run stays quiet.
  const progress = flags.json ? null : spinner("Looking through your agent history…").start();
  let report: StatsReport;
  let providerCount: number;
  try {
    const sessions = await discoverSessions(root, scope, (foundCount) =>
      progress?.update(`Looking through your agent history… (${foundCount} found)`),
    );
    progress?.update("Checking the code each agent wrote…");
    const results = await runStatsScan(sessions, scope.global ? null : root, {
      onProgress: (completedCount, totalCount) =>
        progress?.update(`Checking the code each agent wrote… (${completedCount}/${totalCount})`),
    });
    progress?.update("Scoring…");
    const aggregated = await aggregateStats(results, userConfig);
    providerCount = aggregated.providers.length;

    report = {
      scope: scope.global ? "global" : "repo",
      directory: root,
      models: aggregated.models,
      providers: aggregated.providers,
      best: aggregated.best,
      worst: aggregated.worst,
      sessionsAnalyzed: results.length,
      sessionsRanked: results.filter((result) => result.filesScanned > 0).length,
      sessionsNonReact: results.filter(
        (result) => result.filesScanned === 0 && result.reconstructedFiles > 0,
      ).length,
      sessionsUnreconstructable: results.filter(
        (result) =>
          result.filesScanned === 0 &&
          result.reconstructedFiles === 0 &&
          result.unreconstructable > 0,
      ).length,
      generatedAt: new Date().toISOString(),
    };
    progress?.succeed("Done.");
  } finally {
    progress?.stop();
  }

  recordCount(METRIC.statsRun, 1, {
    scope: report.scope,
    sessions: report.sessionsAnalyzed,
    providers: providerCount,
    provider: scope.provider ?? "all",
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...report }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderStatsReport(report)}\n`);
};
