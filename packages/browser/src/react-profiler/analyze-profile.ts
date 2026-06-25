import {
  MAX_COMMIT_COMPONENTS,
  MAX_PROFILE_COMMITS,
  MAX_PROFILE_COMPONENTS,
} from "../constants.js";
import type {
  ReactComponentRenderStat,
  ReactProfileAnalysis,
  ReactProfileCommitStat,
} from "../types.js";
import { roundToHundredths } from "../utils/round.js";
import type {
  ReactProfilerChangeDescription,
  ReactProfilerDataExport,
} from "./types/profiling-export.js";

// A render is "wasted" when the component re-rendered without anything it owns
// changing — not its first mount, no hook/state/props/context change — i.e. it
// rendered only because a parent did. These are the memo / useCallback targets.
const isUnnecessaryRender = (change: ReactProfilerChangeDescription): boolean => {
  if (change.isFirstMount || change.didHooksChange) return false;
  const changedContext = Array.isArray(change.context)
    ? change.context.length > 0
    : Boolean(change.context);
  const changedProps = change.props?.length ?? 0;
  const changedState = change.state?.length ?? 0;
  return changedProps === 0 && changedState === 0 && !changedContext;
};

// Fold the DevTools profiling export — per-root commits keyed by fiber id — into
// a component-level summary an agent can act on: which components render most and
// cost the most self-time, which commits were the slowest, and how many renders
// were wasted (re-rendered with nothing they own changed).
export const analyzeReactProfile = (data: ReactProfilerDataExport): ReactProfileAnalysis => {
  const componentStats = new Map<string, ReactComponentRenderStat>();
  const commitStats: ReactProfileCommitStat[] = [];
  let totalCommitDurationMs = 0;
  let unnecessaryRenderCount = 0;
  let commitIndex = 0;

  const statFor = (name: string): ReactComponentRenderStat => {
    const existing = componentStats.get(name);
    if (existing) return existing;
    const created: ReactComponentRenderStat = {
      name,
      renderCount: 0,
      totalSelfMs: 0,
      totalActualMs: 0,
      maxSelfMs: 0,
      unnecessaryRenderCount: 0,
    };
    componentStats.set(name, created);
    return created;
  };

  for (const root of data.dataForRoots) {
    const nameByFiber = new Map<number, string>(root.elementNames);
    const nameFor = (fiberId: number): string => nameByFiber.get(fiberId) ?? `#${fiberId}`;

    for (const commit of root.commitData) {
      totalCommitDurationMs += commit.duration;
      const actualByFiber = new Map<number, number>(commit.fiberActualDurations);
      const changeByFiber = new Map(commit.changeDescriptions ?? []);
      const selfByName = new Map<string, number>();

      for (const [fiberId, selfMs] of commit.fiberSelfDurations) {
        const name = nameFor(fiberId);
        const stat = statFor(name);
        stat.renderCount += 1;
        stat.totalSelfMs += selfMs;
        stat.totalActualMs += actualByFiber.get(fiberId) ?? 0;
        stat.maxSelfMs = Math.max(stat.maxSelfMs, selfMs);
        selfByName.set(name, (selfByName.get(name) ?? 0) + selfMs);

        const change = changeByFiber.get(fiberId);
        if (change && isUnnecessaryRender(change)) {
          stat.unnecessaryRenderCount += 1;
          unnecessaryRenderCount += 1;
        }
      }

      const components = [...selfByName.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, MAX_COMMIT_COMPONENTS)
        .map(([name]) => name);
      commitStats.push({ commitIndex, durationMs: roundToHundredths(commit.duration), components });
      commitIndex += 1;
    }
  }

  const topComponents = [...componentStats.values()]
    .sort((a, b) => b.totalSelfMs - a.totalSelfMs)
    .slice(0, MAX_PROFILE_COMPONENTS)
    .map((stat) => ({
      ...stat,
      totalSelfMs: roundToHundredths(stat.totalSelfMs),
      totalActualMs: roundToHundredths(stat.totalActualMs),
      maxSelfMs: roundToHundredths(stat.maxSelfMs),
    }));

  const slowestCommits = [...commitStats]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, MAX_PROFILE_COMMITS);

  return {
    rootCount: data.dataForRoots.length,
    commitCount: commitIndex,
    totalCommitDurationMs: roundToHundredths(totalCommitDurationMs),
    unnecessaryRenderCount,
    topComponents,
    slowestCommits,
  };
};
