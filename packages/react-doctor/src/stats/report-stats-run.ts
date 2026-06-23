import { gzipSync } from "node:zlib";
import { FETCH_TIMEOUT_MS, STATS_API_URL } from "@react-doctor/core";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { STATS_REPORT_SCHEMA_VERSION } from "./constants.js";
import { toLeaderboardRow } from "./leaderboard-row.js";
import type { CommunityLeaderboard, StatsReport } from "./types.js";

const CommunityModelSchema = Schema.Struct({
  model: Schema.String,
  harness: Schema.String,
  communityScore: Schema.NullOr(Schema.Number),
  runs: Schema.Number,
  files: Schema.Number,
});

// The endpoint stores the submitted rows and returns the community leaderboard.
// `Schema.Struct` ignores unknown fields, so extra keys (e.g. `stored`) are
// harmless; a missing/!ok/malformed `community` simply drops to `null`.
const StatsResponseSchema = Schema.Struct({
  community: Schema.optional(
    Schema.Struct({
      generatedAt: Schema.String,
      models: Schema.Array(CommunityModelSchema),
    }),
  ),
});

const parseCommunity = (value: unknown): CommunityLeaderboard | null => {
  const decoded = Option.getOrNull(Schema.decodeUnknownOption(StatsResponseSchema)(value));
  return decoded?.community ?? null;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

const describeFailure = (error: unknown): string => {
  if (isAbortError(error)) return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

// Local-only override so an e2e run can point at a dev server; production uses the
// hardcoded `STATS_API_URL`. Read here (the CLI layer) rather than in core, which
// routes ambient config through `Context.Reference`.
const resolveStatsApiUrl = (): string =>
  process.env.REACT_DOCTOR_STATS_API_URL?.trim() || STATS_API_URL;

/**
 * Sends the run's leaderboard rows — and only those: `{model, harness, score,
 * files}` per model, identical to what the Sentry `stats.leaderboard_row` spans
 * carry — to `/api/stats`, which stores them and returns the community
 * leaderboard. Best-effort: any failure (offline, timeout, non-2xx, malformed
 * body) resolves to `null` so reporting never breaks the rendered board. The
 * caller gates this on telemetry being enabled, so it never runs under
 * `--no-telemetry` / `--no-score`.
 */
export const reportStatsRun = async (report: StatsReport): Promise<CommunityLeaderboard | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const requestBody = JSON.stringify({
      schemaVersion: STATS_REPORT_SCHEMA_VERSION,
      models: report.models.map(toLeaderboardRow),
    });
    const response = await fetch(resolveStatsApiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: gzipSync(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[react-doctor] Stats API returned ${response.status} ${response.statusText}`);
      return null;
    }

    return parseCommunity(await response.json());
  } catch (error) {
    console.warn(`[react-doctor] Stats API unreachable (${describeFailure(error)})`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
