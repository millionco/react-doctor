import * as Sentry from "@sentry/node";
import { isSentryTracingEnabled } from "../../instrument.js";
import { modelLabel } from "../../stats/model-label.js";
import type { GroupStats } from "../../stats/types.js";
import { buildSentryScope } from "./build-sentry-scope.js";
import { toSpanAttributes } from "./to-span-attributes.js";

export type SentryStatsSpan = ReturnType<typeof Sentry.startInactiveSpan> | undefined;

/**
 * Runs a `react-doctor stats` invocation inside a Sentry root span so each
 * leaderboard run is a first-class trace: the discover/scan/aggregate phases
 * become a latency waterfall (see {@link traceStatsPhase}) and every ranked
 * model is one queryable child span (see {@link recordStatsLeaderboard}). The
 * run snapshot rides along as attributes, exactly like the inspect root span.
 *
 * A no-op pass-through when Sentry performance tracing is off (Sentry disabled,
 * `--no-score`, tests, `SENTRY_TRACES_SAMPLE_RATE=0`): `run` receives `undefined`
 * and no transaction is created, so there's no added exit latency. Unlike the
 * inspect root span there's no active-run-trace handle to record — stats has no
 * Effect pipeline whose spans need parenting and no in-scan crash path to link.
 */
export const withSentryStatsSpan = <T>(
  run: (rootSpan: SentryStatsSpan) => Promise<T>,
): Promise<T> => {
  if (!isSentryTracingEnabled()) return run(undefined);
  return Sentry.startSpan(
    {
      name: "react-doctor stats",
      op: "cli.stats",
      attributes: toSpanAttributes(buildSentryScope().tags),
    },
    (rootSpan) => run(rootSpan),
  );
};

/**
 * Wraps one phase of the stats pipeline in a child span so the trace shows where
 * the wall-clock goes (the per-session oxlint scans dominate). A no-op
 * pass-through when tracing is off; otherwise parents under the active stats
 * root span.
 */
export const traceStatsPhase = <T>(name: string, thunk: () => Promise<T>): Promise<T> => {
  if (!isSentryTracingEnabled()) return thunk();
  return Sentry.startSpan({ name, op: "stats.phase" }, () => thunk());
};

/**
 * The four leaderboard dimensions of one ranked model, projected to span
 * attributes: the model name, its harness (the agent tool that ran it), the
 * confidence-weighted 0-100 score (the column the board ranks on — `null` when
 * undersampled, dropped rather than coerced), and the React files scored. Pure
 * and exported so the projection is unit-testable without a live SDK, mirroring
 * `build-run-event.ts`'s `buildRunEventAttributes`.
 */
export const buildStatsRowAttributes = (
  model: GroupStats,
): Record<string, string | number | boolean> =>
  toSpanAttributes({
    "stats.model": modelLabel(model),
    "stats.harness": model.provider,
    "stats.score": model.weightedScore,
    "stats.files": model.filesScanned,
  });

/**
 * Emits one zero-duration child span per ranked model so the leaderboard is
 * queryable in Sentry's Trace Explorer / Spans dataset — filter or group by
 * `stats.harness`, aggregate `stats.score` / `stats.files`. A no-op when the run
 * isn't traced (`rootSpan` absent); otherwise the spans parent under it via the
 * active scope.
 */
export const recordStatsLeaderboard = (
  models: ReadonlyArray<GroupStats>,
  rootSpan: SentryStatsSpan,
): void => {
  if (!rootSpan) return;
  for (const model of models) {
    Sentry.startInactiveSpan({
      name: model.key,
      op: "stats.leaderboard_row",
      attributes: buildStatsRowAttributes(model),
    }).end();
  }
};
