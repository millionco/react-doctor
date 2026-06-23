import * as path from "node:path";
import { resolveScanTarget, type ReactDoctorConfig } from "@react-doctor/core";
import { aggregateStats } from "../../stats/aggregate-stats.js";
import { STATS_DEFAULT_SESSION_LIMIT } from "../../stats/constants.js";
import { discoverSessions } from "../../stats/discover-sessions.js";
import { renderStatsReport } from "../../stats/render-stats.js";
import { reportStatsRun } from "../../stats/report-stats-run.js";
import { runStatsScan } from "../../stats/run-stats-scan.js";
import type {
  CommunityLeaderboard,
  StatsProvider,
  StatsReport,
  StatsScopeOptions,
} from "../../stats/types.js";
import { METRIC } from "../utils/constants.js";
import { enableJsonMode } from "../utils/json-mode.js";
import { recordCount } from "../utils/record-metric.js";
import { spinner } from "../utils/spinner.js";
import {
  recordStatsLeaderboard,
  traceStatsPhase,
  withSentryStatsSpan,
} from "../utils/with-sentry-stats-span.js";

export interface StatsFlags {
  global?: boolean;
  since?: string;
  limit?: string;
  provider?: string;
  json?: boolean;
  cwd?: string;
  // Commander negations from the root program: `--no-score` → `score: false`,
  // `--no-telemetry` → `telemetry: false`. Both opt out of the network.
  score?: boolean;
  telemetry?: boolean;
}

const VALID_PROVIDERS = new Set<string>(["claude", "codex", "cursor"]);

const isStatsProvider = (value: string): value is StatsProvider => VALID_PROVIDERS.has(value);

const parseProvider = (value: string | undefined): StatsProvider | undefined => {
  if (value === undefined) return undefined;
  if (!isStatsProvider(value)) {
    throw new Error(`Unknown provider "${value}". Expected one of: claude, codex, cursor.`);
  }
  return value;
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
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit "${value}". Use a positive integer, e.g. 200.`);
  }
  return parsed;
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
  // Register JSON mode up front so any throw (flag parsing, scan, or score API
  // failure) is emitted as a structured JSON error by the top-level handler
  // instead of plain text — and so incidental logs (e.g. a score-API warning)
  // never corrupt the report on stdout.
  if (flags.json) enableJsonMode({ compact: false, directory });
  const scope: StatsScopeOptions = {
    global: flags.global ?? false,
    since: parseSince(flags.since),
    limit: parseLimit(flags.limit),
    provider: parseProvider(flags.provider),
  };

  const { root, userConfig } = await resolveTarget(directory);

  // `--no-score` / `--no-telemetry` (or `noScore` in config) opt out of the
  // network entirely — same signal `resolve-cli-inspect-options` uses. When off,
  // we skip the score API (scores show n/a, ranked by diagnostics-per-file) and
  // the `/api/stats` report, so a `--no-telemetry` run is fully local.
  const telemetryEnabled = !(
    flags.score === false ||
    flags.telemetry === false ||
    Boolean(userConfig?.noScore)
  );

  // ora renders to stderr; suppress it in JSON mode so the run stays quiet.
  // The whole run is one Sentry trace: each phase below is a child span, and
  // every ranked model becomes a queryable leaderboard-row span.
  const { report, community } = await withSentryStatsSpan<{
    report: StatsReport;
    community: CommunityLeaderboard | null;
  }>(async (rootSpan) => {
    const progress = flags.json ? null : spinner("Looking through your agent history…").start();
    try {
      const sessions = await traceStatsPhase("discover sessions", () =>
        discoverSessions(root, scope, (foundCount) =>
          progress?.update(`Looking through your agent history… (${foundCount} found)`),
        ),
      );
      progress?.update("Checking the code each agent wrote…");
      const results = await traceStatsPhase("scan sessions", () =>
        runStatsScan(sessions, scope.global ? null : root, {
          onProgress: (completedCount, totalCount) =>
            progress?.update(
              `Checking the code each agent wrote… (${completedCount}/${totalCount})`,
            ),
        }),
      );
      progress?.update(telemetryEnabled ? "Scoring…" : "Ranking…");
      const aggregated = await traceStatsPhase("aggregate + score", () =>
        // Skip the score API when telemetry is off: a null scorer leaves every
        // score null, and ranking falls back to diagnostics-per-file.
        aggregateStats(
          results,
          userConfig,
          telemetryEnabled ? undefined : () => Promise.resolve(null),
        ),
      );

      const built: StatsReport = {
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
      recordStatsLeaderboard(built.models, rootSpan);
      // Send the same leaderboard rows to our own store and get the community
      // board back. Best-effort and telemetry-gated; never blocks the result.
      progress?.update("Comparing with the community…");
      const communityBoard = telemetryEnabled
        ? await traceStatsPhase("report leaderboard", () => reportStatsRun(built))
        : null;
      progress?.succeed("Done.");
      return { report: built, community: communityBoard };
    } finally {
      progress?.stop();
    }
  });

  recordCount(METRIC.statsRun, 1, {
    scope: report.scope,
    sessions: report.sessionsAnalyzed,
    providers: report.providers.length,
    provider: scope.provider ?? "all",
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...report }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderStatsReport(report, community)}\n`);
};
