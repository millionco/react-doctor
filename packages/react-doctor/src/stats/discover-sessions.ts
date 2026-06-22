import * as path from "node:path";
import { STATS_SOURCES } from "./sources/index.js";
import { resolveEditPaths } from "./reconstruct-files.js";
import type { AgentSession, StatsScopeOptions } from "./types.js";

const isPathUnder = (childPath: string, parentPath: string): boolean => {
  const relative = path.relative(parentPath, childPath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const sessionTouchesRepo = (session: AgentSession, repoRoot: string): boolean => {
  if (session.cwd && isPathUnder(session.cwd, repoRoot)) return true;
  return resolveEditPaths(session).some((editPath) => isPathUnder(editPath, repoRoot));
};

/**
 * Enumerate, load, and scope-filter agent sessions. By default only sessions
 * that touched `repoRoot` are kept; `--global` lifts that. `--since` and
 * `--limit` bound cost (candidates are loaded newest-first, and loading is lazy
 * so capped runs never touch the whole history). Sessions with no edits are
 * dropped.
 */
export const discoverSessions = (repoRoot: string, scope: StatsScopeOptions): AgentSession[] => {
  const candidates = STATS_SOURCES.filter(
    (source) => !scope.provider || source.name === scope.provider,
  ).flatMap((source) => source.candidates());
  candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);

  const sinceMs = scope.since ? scope.since.getTime() : null;
  const sessions: AgentSession[] = [];
  for (const candidate of candidates) {
    if (sinceMs !== null && candidate.modifiedMs > 0 && candidate.modifiedMs < sinceMs) break;
    const session = candidate.load();
    if (!session || session.edits.length === 0) continue;
    if (!scope.global && !sessionTouchesRepo(session, repoRoot)) continue;
    sessions.push(session);
    if (sessions.length >= scope.limit) break;
  }
  return sessions;
};
