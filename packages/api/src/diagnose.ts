import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  Config,
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
  type InspectOutput,
  type ResolvedScanTarget,
} from "@react-doctor/core";
import type {
  DiagnoseModulesOptions,
  DiagnoseModulesResult,
  DiagnoseOptions,
  DiagnoseResult,
  ModuleDefinition,
  ModuleError,
  ModuleResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";

const DEFAULT_LAYER = Layer.mergeAll(
  Project.layerNode,
  Config.layerNode,
  DeadCode.layerNode,
  Files.layerNode,
  Git.layerNode,
  Linter.layerOxlint,
  LintPartialFailures.layerLive,
  Progress.layerNoop,
  Reporter.layerNoop,
  Score.layerHttp,
);

const buildLayerWithConfigOverride = (
  configOverride: ReactDoctorConfig,
  resolvedDirectory: string,
) =>
  Layer.mergeAll(
    Project.layerNode,
    Config.layerOf({
      config: configOverride,
      resolvedDirectory,
      configSourceDirectory: null,
    }),
    DeadCode.layerNode,
    Files.layerNode,
    Git.layerNode,
    Linter.layerOxlint,
    LintPartialFailures.layerLive,
    Progress.layerNoop,
    Reporter.layerNoop,
    Score.layerHttp,
  );

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

  const skippedChecks: string[] = [];
  const skippedCheckReasons: Record<string, string> = {};
  if (output.didDeadCodeFail && output.deadCodeFailureReason !== null) {
    skippedChecks.push("dead-code");
    skippedCheckReasons["dead-code"] = output.deadCodeFailureReason;
  }

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
  const scanTarget = resolveScanTarget(directory);
  const program = buildInspectProgram(scanTarget, options);

  const output: InspectOutput = await Effect.runPromise(
    restoreLegacyThrow(
      program.pipe(Effect.provide(DEFAULT_LAYER), Effect.provide(layerOtlp)),
    ),
  );

  return outputToDiagnoseResult(output, globalThis.performance.now() - startTime);
};

const findWorstScore = (moduleResults: ModuleResult[]): ScoreResult | null => {
  let worstResult: ScoreResult | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const moduleResult of moduleResults) {
    if (moduleResult.score === null) continue;
    if (moduleResult.score.score < worstScore) {
      worstScore = moduleResult.score.score;
      worstResult = moduleResult.score;
    }
  }
  return worstResult;
};

const diagnoseModule = async (
  moduleDefinition: ModuleDefinition,
  baseOptions: DiagnoseOptions,
): Promise<ModuleResult> => {
  const startTime = globalThis.performance.now();
  const scanTarget = resolveScanTarget(moduleDefinition.directory);
  const { reactDoctorConfig: configOverride, ...perModuleOptions } =
    moduleDefinition.config ?? {};
  const mergedOptions: DiagnoseOptions = { ...baseOptions, ...perModuleOptions };

  const program = buildInspectProgram(scanTarget, mergedOptions, configOverride);

  const layer =
    configOverride !== undefined
      ? buildLayerWithConfigOverride(configOverride, scanTarget.resolvedDirectory)
      : DEFAULT_LAYER;

  const output: InspectOutput = await Effect.runPromise(
    restoreLegacyThrow(
      program.pipe(Effect.provide(layer), Effect.provide(layerOtlp)),
    ),
  );

  return {
    ...outputToDiagnoseResult(output, globalThis.performance.now() - startTime),
    directory: scanTarget.resolvedDirectory,
  };
};

/**
 * Scan multiple modules in parallel and return per-module scores,
 * diagnostics, and an aggregate score (worst-of across all modules).
 *
 * Each module runs its own independent `runInspect` pipeline — the
 * same pipeline `diagnose()` uses — so per-module config overrides,
 * dead-code analysis, and scoring all work identically to a single
 * `diagnose()` call.
 *
 * Modules that fail (e.g. missing `package.json`, no React dependency)
 * are collected in `result.errors` rather than aborting the entire
 * batch, so callers always receive partial results from the modules
 * that succeeded.
 *
 * ```ts
 * const result = await diagnoseModules([
 *   { directory: "packages/app" },
 *   { directory: "packages/shared", config: { deadCode: false } },
 *   { directory: "packages/admin", config: {
 *     reactDoctorConfig: { rules: { "react-doctor/no-array-index-as-key": "off" } },
 *   }},
 * ], { concurrency: 4 });
 *
 * for (const mod of result.modules) {
 *   console.log(mod.directory, mod.score);
 * }
 * ```
 */
export const diagnoseModules = async (
  modules: ModuleDefinition[],
  options: DiagnoseModulesOptions = {},
): Promise<DiagnoseModulesResult> => {
  const startTime = globalThis.performance.now();
  const { concurrency: rawConcurrency, ...baseOptions } = options;
  const concurrency = Math.max(1, rawConcurrency ?? modules.length);

  const moduleResults: ModuleResult[] = [];
  const moduleErrors: ModuleError[] = [];
  const pendingModules = [...modules];

  const runBatch = async (): Promise<void> => {
    const batch: Promise<
      | { ok: true; result: ModuleResult }
      | { ok: false; directory: string; error: Error }
    >[] = [];

    while (pendingModules.length > 0 && batch.length < concurrency) {
      const moduleDefinition = pendingModules.shift()!;
      batch.push(
        diagnoseModule(moduleDefinition, baseOptions).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({
            ok: false as const,
            directory: moduleDefinition.directory,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        ),
      );
    }

    const settled = await Promise.all(batch);
    for (const outcome of settled) {
      if (outcome.ok) {
        moduleResults.push(outcome.result);
      } else {
        moduleErrors.push({
          directory: outcome.directory,
          error: outcome.error,
        });
      }
    }

    if (pendingModules.length > 0) {
      await runBatch();
    }
  };

  await runBatch();

  const allDiagnostics = moduleResults.flatMap(
    (moduleResult) => moduleResult.diagnostics,
  );

  return {
    modules: moduleResults,
    errors: moduleErrors,
    diagnostics: allDiagnostics,
    score: findWorstScore(moduleResults),
    elapsedMilliseconds: globalThis.performance.now() - startTime,
  };
};
