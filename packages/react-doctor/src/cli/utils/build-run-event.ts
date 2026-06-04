import {
  filterDiagnosticsForSurface,
  isReactDoctorError,
  resolveGithubActionsScoreMetadata,
  summarizeDiagnostics,
} from "@react-doctor/core";
import type { FailOnLevel, InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import { ACTION_INPUT_ENVIRONMENT_VARIABLES, detectRunnerOs } from "./is-ci-environment.js";
import { summarizeRuleFirings } from "./record-scan-metrics.js";
import { shouldFailForDiagnostics } from "./should-fail-for-diagnostics.js";
import { toSpanAttributes } from "./to-span-attributes.js";
import type { SentryRootSpan } from "./with-sentry-run-span.js";

// A tag-like map: `null` denotes an absent signal and is dropped by
// `toSpanAttributes` so it never becomes a misleading `"null"` attribute.
interface RunEventAttributes {
  [attributeName: string]: string | number | boolean | null;
}

const FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);

/**
 * Outcome of one scan, attached to its root span (the canonical "wide event").
 * `result` is absent on the failure path (the scan threw before finalizing);
 * `error` is present there so the event still records what happened.
 */
export interface RunEventInput {
  readonly result?: InspectResult;
  /** `"diff"` / `"full"` / `"staged"`. */
  readonly mode: string;
  readonly parallel: boolean;
  readonly workerCount: number | undefined;
  readonly lint: boolean;
  readonly deadCode: boolean;
  readonly scoreOnly: boolean;
  readonly noScore: boolean;
  readonly respectInlineDisables: boolean;
  readonly showWarnings: boolean;
  readonly ignoredTagCount: number;
  readonly hasCustomConfig: boolean;
  readonly userConfig: ReactDoctorConfig | null;
  // Lint / dead-code outcome — only known on the success path. The failure path
  // (the scan threw) omits these rather than asserting a benign default.
  readonly didLintFail?: boolean;
  readonly lintFailureReasonKind?: string | null;
  readonly lintPartialFailureCount?: number;
  readonly didDeadCodeFail?: boolean;
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

// The fail-on threshold for the `wouldBlock` signal. The action forwards its
// own `fail-on` input (so we see the gate even though it's handled outside the
// CLI); otherwise fall back to the config value, then advisory `none`. A bare
// `--fail-on` CLI flag (no action, no config) isn't visible here — an accepted
// gap, since CI gating runs through the action or config.
const resolveTelemetryFailOn = (userConfig: ReactDoctorConfig | null): FailOnLevel => {
  const fromAction = process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.failOn];
  if (fromAction !== undefined && FAIL_ON_LEVELS.has(fromAction as FailOnLevel)) {
    return fromAction as FailOnLevel;
  }
  return userConfig?.failOn ?? "none";
};

// Lowercase, key-safe form of a rule category for the `diag.category.*`
// attribute namespace (categories carry spaces / capitals, e.g. "Performance").
const toCategoryKey = (category: string): string =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, "_");

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
  const failOnLevel = resolveTelemetryFailOn(input.userConfig);
  // Mirror the CLI's real fail-on gate (cli/commands/inspect.ts → finalizeScans):
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
  // on `!isScoreOnly`), so the threshold can't actually block them — keep
  // wouldBlock/outcome/exitCode consistent with the real process exit.
  const wouldBlock = !input.scoreOnly && shouldFailForDiagnostics(gateDiagnostics, failOnLevel);
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

  const attributes: RunEventAttributes = {
    outcome,
    exitCode: wouldBlock ? 1 : 0,
    wouldBlock,
    failOn: failOnLevel,
    scanClean: isClean,
    totalDiagnostics: summary.totalDiagnosticCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    affectedFiles: summary.affectedFileCount,
    distinctRulesFired: countByRule.size,
    topRule,
    scannedFileCount: result.scannedFileCount ?? null,
    elapsedMs: result.elapsedMilliseconds,
    scanPhaseMs: result.scanElapsedMilliseconds ?? null,
    score: result.score ? result.score.score : null,
    scoreLabel: result.score ? result.score.label : null,
    scoreAvailable: result.score !== null,
    skippedCheckCount: result.skippedChecks.length,
    didLintFail: input.didLintFail ?? null,
    lintFailureReasonKind: input.lintFailureReasonKind ?? null,
    lintPartialFailureCount: input.lintPartialFailureCount ?? null,
    didDeadCodeFail: input.didDeadCodeFail ?? null,
  };
  for (const [category, count] of countByCategory) {
    attributes[`diag.category.${toCategoryKey(category)}`] = count;
  }
  return attributes;
};

const buildCiAttributes = (): RunEventAttributes => {
  const { githubActorAssociation } = resolveGithubActionsScoreMetadata();
  return {
    actorAssociation: githubActorAssociation ?? null,
    runnerOs: detectRunnerOs(),
    // Action knobs: present only when the official action forwarded them, so
    // they're `null` (dropped) for any non-action run. The action's `fail-on`
    // is already captured as `failOn` (resolveTelemetryFailOn prefers it).
    nonBlocking: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.nonBlocking),
    comment: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.comment),
    annotations: readEnvBoolean(ACTION_INPUT_ENVIRONMENT_VARIABLES.annotations),
    versionPin: resolveVersionPin(process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version]),
  };
};

const buildConfigAttributes = (input: RunEventInput): RunEventAttributes => {
  const ruleOverrides = input.userConfig?.rules ?? {};
  const ruleKeys = Object.keys(ruleOverrides);
  return {
    mode: input.mode,
    parallel: input.parallel,
    workerCount: input.workerCount ?? null,
    lint: input.lint,
    deadCode: input.deadCode,
    scoreOnly: input.scoreOnly,
    noScore: input.noScore,
    respectInlineDisables: input.respectInlineDisables,
    showWarnings: input.showWarnings,
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
