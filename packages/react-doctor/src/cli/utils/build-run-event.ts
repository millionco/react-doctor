import {
  filterDiagnosticsForSurface,
  isReactDoctorError,
  isScanComplete,
  JSX_FILE_PATTERN,
  resolveGithubActionsScoreMetadata,
  summarizeDiagnostics,
} from "@react-doctor/core";
import type {
  BlockingLevel,
  InspectResult,
  ReactDoctorConfig,
  SuppressedRuleCount,
} from "@react-doctor/core";
import { buildRuleBlastRadii } from "./diagnostic-grouping.js";
import { ACTION_INPUT_ENVIRONMENT_VARIABLES, detectRunnerOs } from "./is-ci-environment.js";
import { summarizeRuleFirings } from "./record-scan-metrics.js";
import { isValidBlockingLevel } from "./resolve-blocking-level.js";
import { isCacheGloballyDisabled } from "./scan-result-cache.js";
import { shouldBlockCi } from "./should-block-ci.js";
import { toCategoryKey } from "./to-category-key.js";
import { toSpanAttributes } from "./to-span-attributes.js";
import { withNamespace } from "./with-namespace.js";
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
  /** `--max-duration` budget in milliseconds; `null` when no budget was set. */
  readonly maxDurationMs: number | null;
  readonly lint: boolean;
  readonly deadCode: boolean;
  // Whether the supply-chain scan is enabled by config/flag (the config analog
  // of `lint`/`deadCode`) — not whether it ran; diff/staged mode skips it anyway.
  readonly supplyChain: boolean;
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
  // Total files skipped because the `--max-duration` budget ran out — the
  // "did the budget actually truncate a scan" kill-metric signal for the
  // flag, distinct from `scan.maxDurationMs` (configured) and
  // `lintDroppedFileCount` (pathological batches).
  readonly lintDeadlineSkippedFileCount?: number;
  readonly didDeadCodeFail?: boolean;
  // `true` when the background supply-chain check hit its overlap budget and
  // failed open to no diagnostics. The kill metric for the lint/supply-chain
  // overlap watches the rate of this per supply-chain-eligible scan (filter to
  // `scan.mode == "full"`, since a skipped check also reports `false`). Known on the
  // success path and replayed from the cached payload on a cache hit — but a
  // timed-out run is never cached (`shouldStoreScanPayload`), so a cache hit
  // always reports `false`. Omitted only on the failure path (the scan threw
  // before finalizing).
  readonly supplyChainOverlapTimedOut?: boolean;
  // `true` when the forked security scan failed open to no diagnostics — the
  // kill metric for that fail-open: a rising rate means fs errors are being
  // swallowed instead of scanned. Never cached (`shouldStoreScanPayload`), so
  // a cache hit reports the healthy `false`; omitted (null) on payloads from
  // before the field and on the failure path.
  readonly securityScanFailed?: boolean;
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
  /**
   * Per-rule tallies of findings the user explicitly silenced (config off
   * switch / per-path override / inline disable comment), from the scan
   * payload — so a cache hit replays them. Rolled up to the `diag.suppressed*`
   * dims; per-rule identity rides the `rule.suppressed` counter instead
   * (100+ rules would blow up the attribute set). Omitted on the failure path.
   */
  readonly suppressedRuleCounts?: ReadonlyArray<SuppressedRuleCount>;
  /**
   * `true` only when this run replayed a whole-repo scan-result payload (the
   * "turbo" path, where no lint / dead-code / score work ran). The explicit
   * marker for `cache.temperature = "turbo"` — never inferred from the
   * per-subsystem cache dims being null, which is also what a cache-off run
   * looks like. Omitted on the failure path.
   */
  readonly wholeRepoCacheHit?: boolean;
  /** Present only when the scan threw. */
  readonly error?: unknown;
}

const readEnvBoolean = (name: string): boolean | null => {
  const value = process.env[name];
  if (value === undefined) return null;
  return value.toLowerCase() === "true" || value === "1";
};

// Reuse fraction of one cache subsystem; `null` (an absent signal, not 0%)
// when the subsystem never consulted its cache this run.
const ratioOf = (
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null =>
  denominator != null && denominator > 0 ? (numerator ?? 0) / denominator : null;

// The dead-code pass's reuse fraction: a whole-result replay is total reuse;
// a fresh analysis reuses whatever fraction of its file summaries the
// incremental store served; a consulted-but-missed result cache with no
// summary stats is zero reuse. `null` when the pass never consulted a cache.
const resolveDeadCodeReuseRatio = (result: InspectResult): number | null => {
  if (result.deadCodeCacheHit === true) return 1;
  const summaryTotal =
    (result.deadCodeSummaryCacheHits ?? 0) + (result.deadCodeSummaryCacheMisses ?? 0);
  if (summaryTotal > 0) return (result.deadCodeSummaryCacheHits ?? 0) / summaryTotal;
  return result.deadCodeCacheHit === false ? 0 : null;
};

/**
 * One queryable cache temperature per scan, derived from the whole stack:
 *
 *   - `"turbo"`    — whole-repo scan-result replay (the explicit
 *                    `wholeRepoCacheHit` flag from the CLI's cachedPayload
 *                    branch; no scan work ran).
 *   - `"warm"`     — any incremental reuse: per-file lint hits, sidecar
 *                    replays, a dead-code whole-result hit, or dead-code
 *                    summary-cache hits.
 *   - `"disabled"` — zero reuse because the global `REACT_DOCTOR_NO_CACHE`
 *                    off-switch is on. Granular per-cache opt-outs
 *                    (`REACT_DOCTOR_NO_FILE_CACHE`, …) still read warm/cold,
 *                    since the other subsystems stay live.
 *   - `"cold"`     — caches on, zero reuse (first scan / everything changed).
 *
 * `cache.warmth` is the headline reuse magnitude in [0, 1]: the plain mean of
 * the subsystem reuse fractions known this run (lint hit ratio, sidecar
 * replay ratio, dead-code reuse), skipping subsystems that never consulted a
 * cache; `1` on turbo, dropped when nothing consulted any cache. Deliberately
 * unweighted — the per-subsystem dims stay the precise signal; warmth is the
 * p50/p90-able summary. Emitted only on the success path.
 */
const buildCacheAttributes = (input: RunEventInput): RunEventAttributes => {
  if (input.result === undefined) return {};
  if (input.wholeRepoCacheHit) {
    return withNamespace("cache", { wholeRepoHit: true, temperature: "turbo", warmth: 1 });
  }
  const result = input.result;
  const subsystemReuseRatios = [
    ratioOf(result.lintCacheHitFileCount, result.lintCacheTotalFileCount),
    ratioOf(result.lintSidecarReplayedFileCount, result.lintSidecarTotalFileCount),
    resolveDeadCodeReuseRatio(result),
  ];
  let knownSubsystemCount = 0;
  let reuseRatioSum = 0;
  for (const reuseRatio of subsystemReuseRatios) {
    if (reuseRatio === null) continue;
    knownSubsystemCount += 1;
    reuseRatioSum += reuseRatio;
  }
  const warmth = knownSubsystemCount > 0 ? reuseRatioSum / knownSubsystemCount : null;
  const temperature =
    warmth !== null && warmth > 0 ? "warm" : isCacheGloballyDisabled() ? "disabled" : "cold";
  return withNamespace("cache", {
    wholeRepoHit: input.wholeRepoCacheHit ?? null,
    temperature,
    warmth,
  });
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
    return withNamespace("outcome", {
      status: "error",
      exitCode: 1,
      complete: false,
      knownError: known,
      errorTag: known ? error.reason._tag : error instanceof Error ? error.name : null,
    });
  }

  const result = input.result;
  const summary = summarizeDiagnostics(result.diagnostics);
  const blockingLevel = resolveTelemetryBlocking(input.userConfig);
  // Mirror the CLI's real blocking gate (cli/commands/inspect.ts → finalizeScans):
  // it tests the threshold against diagnostics filtered for the `ciFailure`
  // surface (weak-signal `design`-tagged rules are dropped by default), so the
  // wide event's `outcome.wouldBlock`/`outcome.status`/`outcome.exitCode` can't disagree with the actual
  // process exit. The descriptive totals below still reflect the full findings.
  const gateDiagnostics = filterDiagnosticsForSurface(
    result.diagnostics,
    "ciFailure",
    input.userConfig,
  );
  // `scoreOnly` runs never raise a non-zero exit (finalizeScans guards the gate
  // on `!isScoreOnly`), and a degraded baseline run (`gateExempt`) skips the
  // gate too — keep `outcome.wouldBlock`/`outcome.status`/`outcome.exitCode` consistent with the real exit.
  const wouldBlock =
    !input.scoreOnly && !input.gateExempt && shouldBlockCi(gateDiagnostics, blockingLevel);
  const complete = isScanComplete({
    analyzedFileCount: result.analyzedFiles?.length,
    scannedFileCount: result.scannedFileCount,
    skippedCheckCount: result.skippedChecks.length,
    skippedCheckReasonCount: Object.keys(result.skippedCheckReasons ?? {}).length,
  });
  const isClean = result.diagnostics.length === 0 && complete;
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

  // Per-category diagnostic counts, keyed so the `diag` namespace yields
  // `diag.category.<key>` once prefixed.
  const categoryRollup: RunEventAttributes = {};
  for (const [category, count] of countByCategory) {
    categoryRollup[`category.${toCategoryKey(category)}`] = count;
  }

  // Findings the user explicitly silenced, by mechanism — the per-scan
  // complement of the `rule.suppressed` counter (which carries rule identity).
  // Absent (not zero) when the caller couldn't supply the tallies.
  const suppressionRollup: RunEventAttributes = {};
  if (input.suppressedRuleCounts) {
    const countBySource = { config: 0, override: 0, inline: 0, "foreign-inline": 0 };
    for (const suppression of input.suppressedRuleCounts) {
      countBySource[suppression.source] += suppression.count;
    }
    suppressionRollup.suppressed =
      countBySource.config +
      countBySource.override +
      countBySource.inline +
      countBySource["foreign-inline"];
    suppressionRollup.suppressedConfig = countBySource.config;
    suppressionRollup.suppressedOverride = countBySource.override;
    suppressionRollup.suppressedInline = countBySource.inline;
    suppressionRollup.suppressedForeignInline = countBySource["foreign-inline"];
  }

  const attributes: RunEventAttributes = {
    ...withNamespace("outcome", {
      status: outcome,
      exitCode: wouldBlock ? 1 : 0,
      wouldBlock,
      blocking: blockingLevel,
      clean: isClean,
      complete,
      skippedChecks: result.skippedChecks.length,
    }),
    ...withNamespace("diag", {
      total: summary.totalDiagnosticCount,
      errors: summary.errorCount,
      warnings: summary.warningCount,
      affectedFiles: summary.affectedFileCount,
      inTestFiles: diagnosticsInTestFiles,
      inStoryFiles: diagnosticsInStoryFiles,
      distinctRules: countByRule.size,
      topRule,
      fixGroups: findingsPerFixGroup.size,
      fixGroupedFindings,
      ...categoryRollup,
      ...suppressionRollup,
    }),
    ...withNamespace("score", {
      value: result.score ? result.score.score : null,
      label: result.score ? result.score.label : null,
      available: result.score !== null,
    }),
    ...withNamespace("lint", {
      failed: input.didLintFail ?? null,
      failureReasonKind: input.lintFailureReasonKind ?? null,
      partialFailureCount: input.lintPartialFailureCount ?? null,
      droppedFileCount: input.lintDroppedFileCount ?? null,
      deadlineSkippedFileCount: input.lintDeadlineSkippedFileCount ?? null,
      // Per-file lint cache outcome. Numeric so Sentry can `p75(lint.cacheHitRatio)`;
      // all `null` when the cache was off/bypassed so "no cache" reads distinctly
      // from a 0% hit rate (`toSpanAttributes` drops the nulls).
      cacheHitFiles: result.lintCacheHitFileCount ?? null,
      cacheTotalFiles: result.lintCacheTotalFileCount ?? null,
      cacheHitRatio: ratioOf(result.lintCacheHitFileCount, result.lintCacheTotalFileCount),
      // Sidecar lint cache outcome — same shape as the per-file cache dims;
      // all `null` when the sidecar cache was off/bypassed.
      sidecarReplayedFiles: result.lintSidecarReplayedFileCount ?? null,
      sidecarTotalFiles: result.lintSidecarTotalFileCount ?? null,
      sidecarReplayRatio: ratioOf(
        result.lintSidecarReplayedFileCount,
        result.lintSidecarTotalFileCount,
      ),
    }),
    ...withNamespace("deadCode", {
      failed: input.didDeadCodeFail ?? null,
      overlapped: input.deadCodeOverlapped ?? null,
      // Dead-code result cache outcome; `null` when the pass never consulted
      // the cache, so "no cache" reads distinctly from a miss.
      cacheHit: result.deadCodeCacheHit ?? null,
      // Incremental summary-cache outcome for the analysis that ran (the
      // kill-criterion metric for the fill overhead: if warm scans are rare,
      // hits stay near zero). Numeric so Sentry can aggregate; `null` when no
      // analysis consulted the incremental store (whole-result hit, cache
      // off, or dead-code skipped).
      summaryCacheHits: result.deadCodeSummaryCacheHits ?? null,
      summaryCacheMisses: result.deadCodeSummaryCacheMisses ?? null,
    }),
    ...withNamespace("supplyChain", {
      overlapTimedOut: input.supplyChainOverlapTimedOut ?? null,
    }),
    ...withNamespace("securityScan", {
      failed: input.securityScanFailed ?? null,
    }),
    ...withNamespace("timing", {
      elapsedMs: result.elapsedMilliseconds,
      scanMs: result.scanElapsedMilliseconds ?? null,
    }),
    ...withNamespace("migration", {
      largestRuleBucketFiles: largestRuleBucket ? largestRuleBucket.fileCount : null,
      largestRuleBucketSites: largestRuleBucket ? largestRuleBucket.siteCount : null,
      largestRuleBucketRule: largestRuleBucket ? largestRuleBucket.ruleKey : null,
    }),
  };
  // Baseline (PR-introduced-issues-only) signal. Emitted only for baseline runs
  // so non-baseline scans stay clean: a computed run carries the delta (`new` is
  // the introduced count == diag.total, plus `fixed` and base `baseTotal`) and
  // `degraded: false`; a degraded run (base ref unfetchable or lint failed,
  // surfaced via `gateExempt`) carries only `degraded: true`. The pair lets a
  // query compute the degradation rate over all baseline runs.
  if (result.baselineDelta) {
    Object.assign(
      attributes,
      withNamespace("baseline", {
        new: summary.totalDiagnosticCount,
        fixed: result.baselineDelta.fixedCount,
        baseTotal: result.baselineDelta.baseTotalCount,
        degraded: false,
      }),
    );
  } else if (input.gateExempt) {
    attributes["baseline.degraded"] = true;
  }
  return attributes;
};

const buildActionAttributes = (): RunEventAttributes => {
  const { githubActorAssociation } = resolveGithubActionsScoreMetadata();
  return withNamespace("action", {
    actorAssociation: githubActorAssociation ?? null,
    runnerOs: detectRunnerOs(),
    // Action knobs: present only when the official action forwarded them, so
    // they're `null` (dropped) for any non-action run. The action's `blocking`
    // is already captured as `outcome.blocking` (resolveTelemetryBlocking
    // prefers it).
    comment: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.comment),
    reviewComments: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.reviewComments),
    versionPin: resolveVersionPin(process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version]),
  });
};

const buildScanAttributes = (input: RunEventInput): RunEventAttributes => {
  const ruleOverrides = input.userConfig?.rules ?? {};
  const ruleKeys = Object.keys(ruleOverrides);
  return withNamespace("scan", {
    mode: input.mode,
    scope: input.scope,
    parallel: input.parallel,
    workerCount: input.workerCount ?? null,
    maxDurationMs: input.maxDurationMs,
    lint: input.lint,
    deadCode: input.deadCode,
    supplyChain: input.supplyChain,
    scoreOnly: input.scoreOnly,
    noScore: input.noScore,
    respectInlineDisables: input.respectInlineDisables,
    showWarnings: input.showWarnings,
    usedOutputDir: input.usedOutputDir,
    ignoredTagCount: input.ignoredTagCount,
    hasCustomConfig: input.hasCustomConfig,
    rulesConfigured: ruleKeys.length,
    rulesDisabled: ruleKeys.filter((key) => ruleOverrides[key] === "off").length,
    // Scan extent — how many files this run covered (the denominator for
    // `diag.affectedFiles`). Known only on the success path.
    fileCount: input.result?.scannedFileCount ?? null,
    nonJsxFileCount:
      input.result?.analyzedFiles?.filter((filePath) => !JSX_FILE_PATTERN.test(filePath)).length ??
      null,
    multilineDiagnosticCount:
      input.result?.diagnostics.filter(
        (diagnostic) => (diagnostic.endLine ?? diagnostic.line) > diagnostic.line,
      ).length ?? null,
  });
};

/**
 * Projects a scan into the namespaced attribute set for its root span — the
 * canonical per-scan "wide event". Every attribute carries a dotted namespace
 * that groups it by concept (`scan.*` config, `action.*` CI knobs, `outcome.*`
 * verdict, `diag.*` findings, `score.*`, `lint.*`, `deadCode.*`, `cache.*`,
 * `supplyChain.*`, `timing.*`, `migration.*`, `baseline.*`) so the attributes
 * tree up in Sentry's attribute browser and stay filter-/group-/aggregate-able
 * in the Spans dataset. Pure and exported so the projection (outcome
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
    ...buildScanAttributes(input),
    ...buildActionAttributes(),
    ...buildOutcomeAttributes(input),
    ...buildCacheAttributes(input),
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
