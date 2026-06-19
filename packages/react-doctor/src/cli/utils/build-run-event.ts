import {
  filterDiagnosticsForSurface,
  isReactDoctorError,
  resolveGithubActionsScoreMetadata,
  summarizeDiagnostics,
} from "@react-doctor/core";
import type { BlockingLevel, InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import { buildRuleBlastRadii } from "./diagnostic-grouping.js";
import { ACTION_INPUT_ENVIRONMENT_VARIABLES, detectRunnerOs } from "./is-ci-environment.js";
import { summarizeRuleFirings } from "./record-scan-metrics.js";
import { isValidBlockingLevel } from "./resolve-blocking-level.js";
import { shouldBlockCi } from "./should-block-ci.js";
import { toCategoryKey } from "./to-category-key.js";
import { toSpanAttributes } from "./to-span-attributes.js";
import type { SentryRootSpan } from "./with-sentry-run-span.js";

// A tag-like map: `null` denotes an absent signal and is dropped by
// `toSpanAttributes` so it never becomes a misleading `"null"` attribute.
interface RunEventAttributes {
  [attributeName: string]: string | number | boolean | null;
}

/**
 * Outcome of one scan, attached to its root span (the canonical "wide event").
 * `result` is absent on the failure path (the scan threw before finalizing);
 * `error` is present there so the event still records what happened.
 */
export interface RunEventInput {
  readonly result?: InspectResult;
  /** `"diff"` / `"full"` / `"staged"`. */
  readonly mode: string;
  /** Resolved scan scope: full | files | changed | lines. */
  readonly scope: string;
  readonly parallel: boolean;
  readonly workerCount: number | undefined;
  readonly lint: boolean;
  readonly deadCode: boolean;
  readonly scoreOnly: boolean;
  readonly noScore: boolean;
  readonly respectInlineDisables: boolean;
  readonly showWarnings: boolean;
  /** A custom `--output-dir` was passed for the full diagnostics dump. */
  readonly usedOutputDir: boolean;
  readonly ignoredTagCount: number;
  readonly hasCustomConfig: boolean;
  readonly userConfig: ReactDoctorConfig | null;
  // Lint / dead-code outcome — only known on the success path. The failure path
  // (the scan threw) omits these rather than asserting a benign default.
  readonly didLintFail?: boolean;
  readonly lintFailureReasonKind?: string | null;
  readonly lintPartialFailureCount?: number;
  // Total files the lint pass dropped (timeout-tripping batches that couldn't
  // be split further). A per-scan outcome dim — the kill-metric signal for LPT:
  // if cost-ordering front-loads the pathological bucket and drops MORE files,
  // this rises on the `cost` cohort vs `arrival`.
  readonly lintDroppedFileCount?: number;
  readonly didDeadCodeFail?: boolean;
  // `true` when the background supply-chain check hit its overlap budget and
  // failed open to no diagnostics. The kill metric for the lint/supply-chain
  // overlap watches the rate of this per supply-chain-eligible scan (filter to
  // `mode == "full"`, since a skipped check also reports `false`). Known on the
  // success path and replayed from the cached payload on a cache hit — but a
  // timed-out run is never cached (`shouldStoreScanPayload`), so a cache hit
  // always reports `false`. Omitted only on the failure path (the scan threw
  // before finalizing).
  readonly supplyChainOverlapTimedOut?: boolean;
  /**
   * Whether the dead-code pass ran concurrently with lint this scan (gate
   * opened / overlap forced). Lets a query compare `runInspect` wall-clock
   * grouped by overlap, and watch for an OOM/timeout regression on
   * overlapped scans (the kill-metric for the overlap feature).
   */
  readonly deadCodeOverlapped?: boolean;
  // A degraded baseline run (no delta computed) skips the CI gate, so the
  // `wouldBlock` prediction must match — never block on its plain-diff findings.
  readonly gateExempt?: boolean;
  /** Present only when the scan threw. */
  readonly error?: unknown;
}

const readEnvBoolean = (name: string): boolean | null => {
  const value = process.env[name];
  if (value === undefined) return null;
  return value.toLowerCase() === "true" || value === "1";
};

// How the official action's `version` input was pinned, derived from the
// forwarded value: `latest`, a local path spec, or an explicit version.
const resolveVersionPin = (versionInput: string | undefined): string | null => {
  if (versionInput === undefined || versionInput.trim() === "") return null;
  if (versionInput === "latest") return "latest";
  if (/^(\.\.?\/|\/)/.test(versionInput)) return "local";
  return "pinned";
};

// The blocking threshold for the `wouldBlock` signal. The action forwards
// its own `blocking` input (so we see the gate even though it's handled by
// the CLI exit code); otherwise fall back to the config value (new name, then
// the deprecated `failOn` alias), then the `"error"` default. A bare
// `--blocking` CLI flag (no action, no config) isn't visible here — an
// accepted gap, since CI gating runs through the action or config.
const resolveTelemetryBlocking = (userConfig: ReactDoctorConfig | null): BlockingLevel => {
  const fromAction = process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking];
  if (fromAction !== undefined && isValidBlockingLevel(fromAction)) {
    return fromAction;
  }
  return userConfig?.blocking ?? userConfig?.failOn ?? "error";
};

const buildOutcomeAttributes = (input: RunEventInput): RunEventAttributes => {
  // Failure path: the scan threw before producing a result.
  if (input.result === undefined) {
    const error = input.error;
    const known = isReactDoctorError(error);
    return {
      outcome: "error",
      exitCode: 1,
      knownError: known,
      errorTag: known ? error.reason._tag : error instanceof Error ? error.name : null,
    };
  }

  const result = input.result;
  const summary = summarizeDiagnostics(result.diagnostics);
  const blockingLevel = resolveTelemetryBlocking(input.userConfig);
  // Mirror the CLI's real blocking gate (cli/commands/inspect.ts → finalizeScans):
  // it tests the threshold against diagnostics filtered for the `ciFailure`
  // surface (weak-signal `design`-tagged rules are dropped by default), so the
  // wide event's wouldBlock/outcome/exitCode can't disagree with the actual
  // process exit. The descriptive totals below still reflect the full findings.
  const gateDiagnostics = filterDiagnosticsForSurface(
    result.diagnostics,
    "ciFailure",
    input.userConfig,
  );
  // `scoreOnly` runs never raise a non-zero exit (finalizeScans guards the gate
  // on `!isScoreOnly`), and a degraded baseline run (`gateExempt`) skips the
  // gate too — keep wouldBlock/outcome/exitCode consistent with the real exit.
  const wouldBlock =
    !input.scoreOnly && !input.gateExempt && shouldBlockCi(gateDiagnostics, blockingLevel);
  const hasSkippedChecks = result.skippedChecks.length > 0;
  const isClean = result.diagnostics.length === 0 && !hasSkippedChecks;
  const outcome = wouldBlock ? "blocked" : isClean ? "clean" : "ok";

  const firings = summarizeRuleFirings(result.diagnostics);
  const countByRule = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  for (const firing of firings) {
    countByRule.set(firing.rule, (countByRule.get(firing.rule) ?? 0) + firing.count);
    countByCategory.set(
      firing.category,
      (countByCategory.get(firing.category) ?? 0) + firing.count,
    );
  }
  let topRule: string | null = null;
  let topRuleCount = 0;
  for (const [rule, count] of countByRule) {
    if (count > topRuleCount) {
      topRule = rule;
      topRuleCount = count;
    }
  }

  // Widest-blast-radius rule: how many files the single most-spread rule
  // touches (and its site count). Lets a query see how common migration-scale
  // buckets are and calibrate MIGRATION_SCALE_RULE_FILE_COUNT — the threshold
  // that fires the "sample before you sweep" advisory — against real scans.
  const largestRuleBucket = buildRuleBlastRadii(result.diagnostics)[0] ?? null;

  let diagnosticsInTestFiles = 0;
  let diagnosticsInStoryFiles = 0;
  // Root-cause grouping rollup: how many distinct fix groups, and how many
  // findings they cover. `fixGroupedFindings - fixGroups` is the number of
  // findings that collapse away (one fix, not N tasks) — the signal that says
  // whether this feature fires on real repos and how much it folds.
  const findingsPerFixGroup = new Map<string, number>();
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.fileContext === "test") diagnosticsInTestFiles += 1;
    if (diagnostic.fileContext === "story") diagnosticsInStoryFiles += 1;
    if (diagnostic.fixGroupId) {
      findingsPerFixGroup.set(
        diagnostic.fixGroupId,
        (findingsPerFixGroup.get(diagnostic.fixGroupId) ?? 0) + 1,
      );
    }
  }
  let fixGroupedFindings = 0;
  for (const count of findingsPerFixGroup.values()) fixGroupedFindings += count;

  const attributes: RunEventAttributes = {
    outcome,
    exitCode: wouldBlock ? 1 : 0,
    wouldBlock,
    blocking: blockingLevel,
    scanClean: isClean,
    totalDiagnostics: summary.totalDiagnosticCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    affectedFiles: summary.affectedFileCount,
    diagnosticsInTestFiles,
    diagnosticsInStoryFiles,
    distinctRulesFired: countByRule.size,
    "diag.fixGroups": findingsPerFixGroup.size,
    "diag.fixGroupedFindings": fixGroupedFindings,
    topRule,
    "migration.largestRuleBucketFiles": largestRuleBucket ? largestRuleBucket.fileCount : null,
    "migration.largestRuleBucketSites": largestRuleBucket ? largestRuleBucket.siteCount : null,
    "migration.largestRuleBucketRule": largestRuleBucket ? largestRuleBucket.ruleKey : null,
    scannedFileCount: result.scannedFileCount ?? null,
    // Per-file lint cache outcome. Numeric so Sentry can `p75(lintCacheHitRatio)`;
    // all `null` when the cache was off/bypassed so "no cache" reads distinctly
    // from a 0% hit rate (`toSpanAttributes` drops the nulls).
    lintCacheHitFiles: result.lintCacheHitFileCount ?? null,
    lintCacheTotalFiles: result.lintCacheTotalFileCount ?? null,
    lintCacheHitRatio:
      result.lintCacheTotalFileCount != null && result.lintCacheTotalFileCount > 0
        ? (result.lintCacheHitFileCount ?? 0) / result.lintCacheTotalFileCount
        : null,
    elapsedMs: result.elapsedMilliseconds,
    scanPhaseMs: result.scanElapsedMilliseconds ?? null,
    score: result.score ? result.score.score : null,
    scoreLabel: result.score ? result.score.label : null,
    scoreAvailable: result.score !== null,
    skippedCheckCount: result.skippedChecks.length,
    didLintFail: input.didLintFail ?? null,
    lintFailureReasonKind: input.lintFailureReasonKind ?? null,
    lintPartialFailureCount: input.lintPartialFailureCount ?? null,
    lintDroppedFileCount: input.lintDroppedFileCount ?? null,
    didDeadCodeFail: input.didDeadCodeFail ?? null,
    supplyChainOverlapTimedOut: input.supplyChainOverlapTimedOut ?? null,
    deadCodeOverlapped: input.deadCodeOverlapped ?? null,
  };
  for (const [category, count] of countByCategory) {
    attributes[`diag.category.${toCategoryKey(category)}`] = count;
  }
  // Baseline (PR-introduced-issues-only) signal. Emitted only for baseline runs
  // so non-baseline scans stay clean: a computed run carries the delta (`new` is
  // the introduced count == totalDiagnostics, plus `fixed` and base `baseTotal`)
  // and `degraded: false`; a degraded run (base ref unfetchable or lint failed,
  // surfaced via `gateExempt`) carries only `degraded: true`. The pair lets a
  // query compute the degradation rate over all baseline runs.
  if (result.baselineDelta) {
    attributes["baseline.new"] = summary.totalDiagnosticCount;
    attributes["baseline.fixed"] = result.baselineDelta.fixedCount;
    attributes["baseline.baseTotal"] = result.baselineDelta.baseTotalCount;
    attributes["baseline.degraded"] = false;
  } else if (input.gateExempt) {
    attributes["baseline.degraded"] = true;
  }
  return attributes;
};

const buildCiAttributes = (): RunEventAttributes => {
  const { githubActorAssociation } = resolveGithubActionsScoreMetadata();
  return {
    actorAssociation: githubActorAssociation ?? null,
    runnerOs: detectRunnerOs(),
    // Action knobs: present only when the official action forwarded them, so
    // they're `null` (dropped) for any non-action run. The action's
    // `blocking` is already captured as `blocking`
    // (resolveTelemetryBlocking prefers it).
    comment: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.comment),
    reviewComments: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.reviewComments),
    versionPin: resolveVersionPin(process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version]),
  };
};

const buildConfigAttributes = (input: RunEventInput): RunEventAttributes => {
  const ruleOverrides = input.userConfig?.rules ?? {};
  const ruleKeys = Object.keys(ruleOverrides);
  return {
    mode: input.mode,
    scope: input.scope,
    parallel: input.parallel,
    workerCount: input.workerCount ?? null,
    lint: input.lint,
    deadCode: input.deadCode,
    scoreOnly: input.scoreOnly,
    noScore: input.noScore,
    respectInlineDisables: input.respectInlineDisables,
    showWarnings: input.showWarnings,
    usedOutputDir: input.usedOutputDir,
    ignoredTagCount: input.ignoredTagCount,
    hasCustomConfig: input.hasCustomConfig,
    rulesConfigured: ruleKeys.length,
    rulesDisabled: ruleKeys.filter((key) => ruleOverrides[key] === "off").length,
  };
};

/**
 * Projects a scan into the flat attribute set for its root span — the canonical
 * per-scan "wide event". Pure and exported so the projection (outcome
 * precedence, rule/category rollups, CI knobs, config shape) is unit-testable
 * without a live Sentry client. `null` values are dropped so absent signals
 * never become misleading `"null"` attributes. The run + project base context
 * (version, command, ci/provider, framework, …) is already on the span from
 * `withSentryRunSpan` / `recordSentryProjectContext`, so this adds only what
 * those don't carry.
 */
export const buildRunEventAttributes = (
  input: RunEventInput,
): Record<string, string | number | boolean> =>
  toSpanAttributes({
    ...buildConfigAttributes(input),
    ...buildCiAttributes(),
    ...buildOutcomeAttributes(input),
  });

/**
 * Stamps the wide-event attributes onto the run's root span. A guarded no-op
 * when tracing is off (no `rootSpan`) and swallow-on-throw, so telemetry can
 * never break the run.
 */
export const recordRunEvent = (rootSpan: SentryRootSpan, input: RunEventInput): void => {
  if (!rootSpan) return;
  try {
    rootSpan.setAttributes(buildRunEventAttributes(input));
  } catch {}
};
