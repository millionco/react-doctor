import { STATS_DISCOVERY_YIELD_INTERVAL } from "./constants.js";
import { isPathInside } from "./is-path-inside.js";
import { STATS_SOURCES } from "./sources/index.js";
import { resolveEditPaths } from "./reconstruct-files.js";
import type { AgentSession, StatsScopeOptions } from "./types.js";

/** Reports discovery progress: sessions kept so far, candidates scanned so far. */
export type DiscoveryProgress = (foundCount: number, scannedCount: number) => void;

const sessionTouchesRepo = (session: AgentSession, repoRoot: string): boolean => {
  if (session.cwd && isPathInside(session.cwd, repoRoot, { allowSame: true })) return true;
  return resolveEditPaths(session).some((editPath) =>
    isPathInside(editPath, repoRoot, { allowSame: true }),
  );
};

/**
 * Enumerate, load, and scope-filter agent sessions. By default only sessions
 * that touched `repoRoot` are kept; `--global` lifts that. `--since` and
 * `--limit` bound cost (candidates are loaded newest-first, and loading is lazy
 * so capped runs never touch the whole history). Sessions with no edits are
 * dropped. Loading is synchronous per candidate, so the loop yields to the event
 * loop periodically (and reports progress) to keep the spinner responsive.
 */
export const discoverSessions = async (
  repoRoot: string,
  scope: StatsScopeOptions,
  onProgress?: DiscoveryProgress,
): Promise<AgentSession[]> => {
  const candidates = STATS_SOURCES.filter(
    (source) => !scope.provider || source.name === scope.provider,
  ).flatMap((source) => source.candidates());
  candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);

  const sinceMs = scope.since ? scope.since.getTime() : null;
  const sessions: AgentSession[] = [];
  let scannedCount = 0;
  for (const candidate of candidates) {
    // With `--since`, a candidate whose timestamp is unknown (`modifiedMs <= 0`)
    // can't be proven on-or-after the cutoff, so it's excluded rather than
    // ambiguously kept. Dated candidates are sorted newest-first, so the first
    // one older than the cutoff ends the walk.
    if (sinceMs !== null) {
      if (candidate.modifiedMs <= 0) continue;
      if (candidate.modifiedMs < sinceMs) break;
    }

    const session = await candidate.load();
    scannedCount += 1;
    if (
      session &&
      session.edits.length > 0 &&
      (scope.global || sessionTouchesRepo(session, repoRoot))
    ) {
      sessions.push(session);
    }

    if (scannedCount % STATS_DISCOVERY_YIELD_INTERVAL === 0) {
      onProgress?.(sessions.length, scannedCount);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (sessions.length >= scope.limit) break;
  }
  return sessions;
};
