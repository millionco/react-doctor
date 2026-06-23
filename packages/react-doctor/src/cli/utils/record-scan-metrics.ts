import { getDiagnosticRuleIdentity } from "@react-doctor/core";
import type { Diagnostic, InspectResult } from "@react-doctor/core";
import { METRIC } from "./constants.js";
import { recordCount, recordDistribution } from "./record-metric.js";

export interface RuleFiring {
  readonly rule: string;
  readonly plugin: string;
  readonly category: string;
  readonly severity: string;
  readonly count: number;
}

/**
 * Aggregates diagnostics into per-`(rule, severity)` firing counts, reusing the
 * canonical `getDiagnosticRuleIdentity` so the `<plugin>/<rule>` key and
 * category match every other rule-keyed surface. Pure and exported so the
 * bucketing is unit-testable without an active Sentry client (the emit helpers
 * no-op under tests). Grouping the emitted `rule.fired` counter by `category`
 * or `severity` in Sentry reproduces a coarser breakdown.
 */
export const summarizeRuleFirings = (diagnostics: ReadonlyArray<Diagnostic>): RuleFiring[] => {
  // Keyed by rule + severity joined with NUL — a delimiter that can't appear in
  // a `<plugin>/<rule>` id or a severity, so distinct pairs never collide.
  const firings = new Map<string, RuleFiring>();
  for (const diagnostic of diagnostics) {
    const { ruleKey, category } = getDiagnosticRuleIdentity(diagnostic);
    const firingKey = `${ruleKey}\u0000${diagnostic.severity}`;
    const existing = firings.get(firingKey);
    firings.set(
      firingKey,
      existing
        ? { ...existing, count: existing.count + 1 }
        : {
            rule: ruleKey,
            plugin: diagnostic.plugin,
            category,
            severity: diagnostic.severity,
            count: 1,
          },
    );
  }
  return [...firings.values()];
};

export interface ScanMetricsInput {
  readonly result: InspectResult;
  /** `"diff"` (changed/staged files) or `"full"` (whole project). */
  readonly mode: string;
  /** Whether the lint pass fanned out to more than one worker (`workerCount > 1`). */
  readonly parallel: boolean;
  /**
   * Resolved lint worker count the scan actually used — the auto-detected
   * count on the default parallel path, or the caller's `REACT_DOCTOR_PARALLEL`
   * / `inspect({ concurrency })` pin. `undefined` only when a pre-field cache
   * hit can't recover it.
   */
  readonly workerCount: number | undefined;
  readonly lint: boolean;
  readonly deadCode: boolean;
  readonly scoreOnly: boolean;
  readonly noScore: boolean;
  readonly didLintFail: boolean;
  readonly lintFailureReasonKind: string | null;
  readonly didDeadCodeFail: boolean;
  /** A baseline run that couldn't compute a delta and fell back to a plain diff. */
  readonly baselineDegraded: boolean;
}

/**
 * Emits the per-scan engineering + product counters/distributions for one
 * `inspect()` run (fires once per project in a workspace scan). Every emission
 * is a no-op unless Sentry is live, and the shared run/project attributes ride
 * along from the global scope, so call sites only pass scan-specific dimensions.
 */
export const recordScanMetrics = (input: ScanMetricsInput): void => {
  const { result } = input;
  const hasSkippedChecks = result.skippedChecks.length > 0;

  recordCount(METRIC.scanCompleted, 1, {
    mode: input.mode,
    lint: input.lint,
    deadCode: input.deadCode,
    parallel: input.parallel,
    scoreOnly: input.scoreOnly,
    didLintFail: input.didLintFail,
    didDeadCodeFail: input.didDeadCodeFail,
    hasSkippedChecks,
  });

  recordDistribution(METRIC.scanDuration, result.elapsedMilliseconds, {
    unit: "millisecond",
    attributes: { mode: input.mode, parallel: input.parallel, scoreOnly: input.scoreOnly },
  });
  if (result.scanElapsedMilliseconds !== undefined) {
    recordDistribution(METRIC.scanPhaseDuration, result.scanElapsedMilliseconds, {
      unit: "millisecond",
      attributes: { mode: input.mode },
    });
  }
  if (result.scannedFileCount !== undefined) {
    recordDistribution(METRIC.scanFiles, result.scannedFileCount, {
      attributes: { mode: input.mode },
    });
  }
  if (input.workerCount !== undefined) {
    recordDistribution(METRIC.oxlintWorkers, input.workerCount, {
      attributes: { mode: input.mode },
    });
  }

  for (const firing of summarizeRuleFirings(result.diagnostics)) {
    recordCount(METRIC.ruleFired, firing.count, {
      rule: firing.rule,
      plugin: firing.plugin,
      category: firing.category,
      severity: firing.severity,
    });
  }
  // "Clean" means the scan actually completed and found nothing — not that a
  // failed/incomplete run (lint or dead-code failed, a check was skipped)
  // happened to produce zero diagnostics. `skippedChecks` already includes
  // lint/dead-code failures, so it's the single "fully completed" signal.
  if (result.diagnostics.length === 0 && !hasSkippedChecks) {
    recordCount(METRIC.scanClean, 1, { mode: input.mode });
  }

  if (result.score) {
    recordDistribution(METRIC.scanScore, result.score.score, {
      attributes: { mode: input.mode },
    });
  } else if (!input.noScore && !input.didLintFail) {
    // Score is null despite scoring being on and lint succeeding: the hosted
    // score API was unreachable from this client.
    recordCount(METRIC.scoreUnavailable, 1, { mode: input.mode });
  }

  if (input.baselineDegraded) {
    // Baseline fell back to a plain diff (base lint failed / no reliable delta).
    // A spike here means baseline isn't working as intended in users' CI.
    recordCount(METRIC.baselineDegraded, 1);
  }
  if (input.didLintFail) {
    recordCount(METRIC.lintFailed, 1, { reasonKind: input.lintFailureReasonKind });
  }
  if (input.didDeadCodeFail) {
    recordCount(METRIC.deadCodeFailed, 1);
  }
  for (const check of result.skippedChecks) {
    recordCount(METRIC.scanCheckSkipped, 1, {
      check,
      reason: result.skippedCheckReasons?.[check] ?? null,
    });
  }
};
