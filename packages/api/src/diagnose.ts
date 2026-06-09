import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  buildSkippedChecks,
  Config,
  DEFAULT_SHOW_WARNINGS,
  DeadCode,
  Files,
  Git,
  layerOtlp,
  Linter,
  LintPartialFailures,
  Progress,
  Project,
  Reporter,
  resolveScanTarget,
  restoreLegacyThrow,
  runInspect,
  Score,
  SupplyChain,
  type InspectOutput,
  type ResolvedScanTarget,
} from "@react-doctor/core";
import type {
  DiagnoseOptions,
  DiagnoseProjectsInput,
  DiagnoseProjectsResult,
  DiagnoseResult,
  ProjectDefinition,
  ProjectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";

// The production layer stack for the programmatic API. The only axis that
// varies across calls is `Config`: with no override we load from disk
// (`Config.layerNode`); with a per-project override the caller's already
// resolved config drives `Config.layerOf(...)`. The supply-chain gate reads
// `supplyChain.enabled` from that same effective config (default on), so the
// one config input decides both. Every other service is identical, so the
// stack is built once here rather than duplicated per variant.
const buildDiagnoseLayer = (
  config: ReactDoctorConfig | null,
  configOverride?: { readonly resolvedDirectory: string },
) => {
  const configLayer =
    configOverride === undefined
      ? Config.layerNode
      : Config.layerOf({
          config,
          resolvedDirectory: configOverride.resolvedDirectory,
          configSourceDirectory: null,
        });
  return Layer.mergeAll(
    Project.layerNode,
    configLayer,
    DeadCode.layerNode,
    Files.layerNode,
    Git.layerNode,
    Linter.layerOxlint,
    LintPartialFailures.layerLive,
    Progress.layerNoop,
    Reporter.layerNoop,
    Score.layerHttp,
    config?.supplyChain?.enabled !== false ? SupplyChain.layerNode : SupplyChain.layerOf([]),
  );
};

const buildInspectProgram = (
  scanTarget: ResolvedScanTarget,
  options: DiagnoseOptions,
  configOverride?: ReactDoctorConfig,
) => {
  const effectiveConfig = configOverride ?? scanTarget.userConfig;
  const includePaths = options.includePaths ?? [];

  return runInspect({
    directory: scanTarget.resolvedDirectory,
    includePaths,
    customRulesOnly: effectiveConfig?.customRulesOnly ?? false,
    respectInlineDisables:
      options.respectInlineDisables ?? effectiveConfig?.respectInlineDisables ?? true,
    warnings: options.warnings ?? effectiveConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    adoptExistingLintConfig: effectiveConfig?.adoptExistingLintConfig ?? true,
    ignoredTags: new Set(effectiveConfig?.ignore?.tags ?? []),
    runDeadCode: options.deadCode ?? effectiveConfig?.deadCode ?? true,
    isCi: false,
    resolveLocalGithubViewerPermission: true,
  });
};

const outputToDiagnoseResult = (
  output: InspectOutput,
  elapsedMilliseconds: number,
): DiagnoseResult => {
  // HACK: preserve the legacy behavior of writing lint failures to
  // stderr. The orchestrator already folds them into didLintFail /
  // lintFailureReason; this mirror keeps long-running scripts that
  // grep stderr for "Lint failed" working unchanged.
  if (output.didLintFail && output.lintFailureReason !== null) {
    console.error("Lint failed:", output.lintFailureReason);
  }

  const { skippedChecks, skippedCheckReasons } = buildSkippedChecks(output);

  return {
    diagnostics: [...output.diagnostics],
    score: output.score,
    skippedChecks,
    ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
    project: output.project,
    elapsedMilliseconds,
  };
};

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const startTime = globalThis.performance.now();
  const scanTarget = await resolveScanTarget(directory);
  const program = buildInspectProgram(scanTarget, options);

  const output: InspectOutput = await Effect.runPromise(
    restoreLegacyThrow(
      program.pipe(
        Effect.provide(buildDiagnoseLayer(scanTarget.userConfig)),
        Effect.provide(layerOtlp),
      ),
    ),
  );

  return outputToDiagnoseResult(output, globalThis.performance.now() - startTime);
};

const findWorstScore = (projectResults: ProjectResult[]): ScoreResult | null => {
  let worstResult: ScoreResult | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const projectResult of projectResults) {
    if (!projectResult.ok || projectResult.score === null) continue;
    if (projectResult.score.score < worstScore) {
      worstScore = projectResult.score.score;
      worstResult = projectResult.score;
    }
  }
  return worstResult;
};

const diagnoseProject = async (
  projectDefinition: ProjectDefinition,
  baseOptions: DiagnoseOptions,
): Promise<ProjectResult> => {
  const startTime = globalThis.performance.now();

  try {
    const scanTarget = await resolveScanTarget(projectDefinition.directory);
    const { directory: _, config: configOverride, ...perProjectOptions } = projectDefinition;
    const mergedOptions: DiagnoseOptions = { ...baseOptions, ...perProjectOptions };

    const program = buildInspectProgram(scanTarget, mergedOptions, configOverride);

    const effectiveConfig = configOverride ?? scanTarget.userConfig;
    const layer = buildDiagnoseLayer(
      effectiveConfig,
      configOverride !== undefined
        ? { resolvedDirectory: scanTarget.resolvedDirectory }
        : undefined,
    );

    const output: InspectOutput = await Effect.runPromise(
      restoreLegacyThrow(program.pipe(Effect.provide(layer), Effect.provide(layerOtlp))),
    );

    return {
      ok: true,
      ...outputToDiagnoseResult(output, globalThis.performance.now() - startTime),
      directory: scanTarget.resolvedDirectory,
    };
  } catch (error) {
    return {
      ok: false,
      directory: projectDefinition.directory,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

/**
 * Scan multiple projects in parallel and return per-project scores,
 * diagnostics, and an aggregate score (worst-of across all projects).
 *
 * Each project runs its own independent `runInspect` pipeline — the
 * same pipeline `diagnose()` uses — so per-project config overrides,
 * dead-code analysis, and scoring all work identically to a single
 * `diagnose()` call.
 *
 * Projects that fail (e.g. missing `package.json`, no React dependency)
 * are included in the result with `ok: false` rather than aborting the
 * entire batch, so callers always receive partial results.
 *
 * ```ts
 * const result = await diagnoseProjects({
 *   projects: [
 *     { directory: "packages/app" },
 *     { directory: "packages/shared", deadCode: false },
 *     { directory: "packages/admin", config: {
 *       rules: { "react-doctor/no-array-index-as-key": "off" },
 *     }},
 *   ],
 *   concurrency: 4,
 * });
 *
 * for (const project of result.projects) {
 *   if (project.ok) {
 *     console.log(project.directory, project.score);
 *   } else {
 *     console.error(project.directory, project.error);
 *   }
 * }
 * ```
 */
export const diagnoseProjects = async (
  input: DiagnoseProjectsInput,
): Promise<DiagnoseProjectsResult> => {
  const startTime = globalThis.performance.now();
  const { projects, concurrency: rawConcurrency, ...baseOptions } = input;
  const concurrency = Math.max(1, rawConcurrency ?? projects.length);

  const projectResults: ProjectResult[] = [];
  const pendingProjects = [...projects];

  const runBatch = async (): Promise<void> => {
    const batch: Promise<ProjectResult>[] = [];

    while (pendingProjects.length > 0 && batch.length < concurrency) {
      const projectDefinition = pendingProjects.shift()!;
      batch.push(diagnoseProject(projectDefinition, baseOptions));
    }

    const batchResults = await Promise.all(batch);
    projectResults.push(...batchResults);

    if (pendingProjects.length > 0) {
      await runBatch();
    }
  };

  await runBatch();

  const allDiagnostics = projectResults.flatMap((projectResult) =>
    projectResult.ok ? projectResult.diagnostics : [],
  );

  return {
    projects: projectResults,
    diagnostics: allDiagnostics,
    score: findWorstScore(projectResults),
    elapsedMilliseconds: globalThis.performance.now() - startTime,
  };
};
