import { modelLabel } from "./model-label.js";
import type { GroupStats } from "./types.js";

/**
 * One leaderboard row reduced to its four shareable dimensions: the bare model
 * name, the harness (the agent tool that ran it), the confidence-weighted 0-100
 * score (`null` when undersampled), and the React files scored.
 *
 * This is the single source for everything the stats feature reports off the
 * machine — the Sentry `stats.leaderboard_row` span attributes and the
 * `/api/stats` payload both project from it, so the two sinks can never drift and
 * both stay code-free: no source text, paths, or repo identity ever appears here.
 */
export interface LeaderboardRow {
  readonly model: string;
  readonly harness: string;
  readonly score: number | null;
  readonly files: number;
}

export const toLeaderboardRow = (group: GroupStats): LeaderboardRow => ({
  model: modelLabel(group),
  harness: group.provider,
  score: group.weightedScore,
  files: group.filesScanned,
});
