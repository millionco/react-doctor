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
import { withNamespace } from "./with-namespace.js";
import type { SentryRootSpan } from "./with-sentry-run-span.js";

interface RunEventAttributes {
  [attributeName: string]: string | number | boolean | null;
}

export interface RunEventInput {
  readonly result?: InspectResult;
  /** `"full"` / `"diff"` / `"baseline"`. */
  readonly mode: string;
  readonly scope: string;
  readonly parallel: boolean;
  readonly workerCount: number | undefined;
  readonly lint: boolean;
  readonly deadCode: boolean;
  readonly scoreOnly: boolean;
  readonly noScore: boolean;
  readonly respectInlineDisables: boolean;
  readonly showWarnings: boolean;
  readonly usedOutputDir: boolean;
  readonly ignoredTagCount: number;
  readonly hasCustomConfig: boolean;
  readonly userConfig: ReactDoctorConfig | null;
  readonly didLintFail?: boolean;
  readonly lintFailureReasonKind?: string | null;
  readonly lintPartialFailureCount?: number;
  readonly lintDroppedFileCount?: number;
  readonly didDeadCodeFail?: boolean;
  readonly supplyChainOverlapTimedOut?: boolean;
  readonly deadCodeOverlapped?: boolean;
  readonly gateExempt?: boolean;
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

const resolveTelemetryBlocking = (userConfig: ReactDoctorConfig | null): BlockingLevel => {
  const fromAction = process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking];
  if (fromAction !== undefined && isValidBlockingLevel(fromAction)) {
    return fromAction;
  }
  return userConfig?.blocking ?? userConfig?.failOn ?? "error";
};

const buildOutcomeAttributes = (input: RunEventInput): RunEventAttributes => {
  if (input.result === undefined) {
    const error = input.error;
    const known = isReactDoctorError(error);
    return withNamespace("outcome", {
      status: "error",
      exitCode: 1,
      knownError: known,
      errorTag: known ? error.reason._tag : error instanceof Error ? error.name : null,
    });
  }

  const result = input.result;
  const summary = summarizeDiagnostics(result.diagnostics);
  const blockingLevel = resolveTelemetryBlocking(input.userConfig);
  const gateDiagnostics = filterDiagnosticsForSurface(
    result.diagnostics,
    "ciFailure",
    input.userConfig,
  );
  const wouldBlock =
    !input.scoreOnly && !input.gateExempt && shouldBlockCi(gateDiagnostics, blockingLevel);
  const hasSkippedChecks = result.skippedChecks.length > 0;
  const isClean = result.diagnostics.length === 0 && !hasSkippedChecks;
  let outcome = "ok";
  if (wouldBlock) {
    outcome = "blocked";
  } else if (isClean) {
    outcome = "clean";
  }

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

  const largestRuleBucket = buildRuleBlastRadii(result.diagnostics)[0] ?? null;

  let diagnosticsInTestFiles = 0;
  let diagnosticsInStoryFiles = 0;
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

  const categoryRollup: RunEventAttributes = {};
  for (const [category, count] of countByCategory) {
    categoryRollup[`category.${toCategoryKey(category)}`] = count;
  }

  const attributes: RunEventAttributes = {
    ...withNamespace("outcome", {
      status: outcome,
      exitCode: wouldBlock ? 1 : 0,
      wouldBlock,
      blocking: blockingLevel,
      clean: isClean,
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
      cacheHitFiles: result.lintCacheHitFileCount ?? null,
      cacheTotalFiles: result.lintCacheTotalFileCount ?? null,
      cacheHitRatio:
        result.lintCacheTotalFileCount != null && result.lintCacheTotalFileCount > 0
          ? (result.lintCacheHitFileCount ?? 0) / result.lintCacheTotalFileCount
          : null,
    }),
    ...withNamespace("deadCode", {
      failed: input.didDeadCodeFail ?? null,
      overlapped: input.deadCodeOverlapped ?? null,
    }),
    ...withNamespace("supplyChain", {
      overlapTimedOut: input.supplyChainOverlapTimedOut ?? null,
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
    Object.assign(attributes, withNamespace("baseline", { degraded: true }));
  }
  return attributes;
};

const buildActionAttributes = (): RunEventAttributes => {
  const { githubActorAssociation } = resolveGithubActionsScoreMetadata();
  return withNamespace("action", {
    actorAssociation: githubActorAssociation ?? null,
    runnerOs: detectRunnerOs(),
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
    fileCount: input.result?.scannedFileCount ?? null,
  });
};

export const buildRunEventAttributes = (
  input: RunEventInput,
): Record<string, string | number | boolean> =>
  toSpanAttributes({
    ...buildScanAttributes(input),
    ...buildActionAttributes(),
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
