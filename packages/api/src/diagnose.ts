import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  buildSkippedChecks,
  Config,
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  DEFAULT_SHOW_WARNINGS,
  DeadCode,
  detectAiTrainingEnvironment,
  Files,
  Git,
  hasReactRuntime,
  layerOtlp,
  Linter,
  LintPartialFailures,
  mapWithConcurrency,
  mergeReactDoctorConfigs,
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

// The CLI carries the richer warning (logger + telemetry); the library only
// has stdout, so it warns once per process via console.warn when a scan runs
// inside an AI/ML training environment (license requires written permission).
let didWarnAiTraining = false;
const warnIfAiTrainingEnvironment = (): void => {
  if (didWarnAiTraining || detectAiTrainingEnvironment() === null) return;
  didWarnAiTraining = true;
  console.warn(
    "[react-doctor] Use in an AI or ML pipeline requires written permission under the react-doctor license. Contact founders@million.dev to request access.",
  );
};

interface DiagnoseLayerInput {
  readonly config: ReactDoctorConfig | null;
  readonly shouldRunLint: boolean;
  readonly shouldRunDeadCode: boolean;
  readonly configOverrideTarget?: Pick<
    ResolvedScanTarget,
    "resolvedDirectory" | "configSourceDirectory"
  >;
}

const resolveShouldRunLint = (
  options: DiagnoseOptions,
  effectiveConfig: ReactDoctorConfig | null,
): boolean => options.lint ?? effectiveConfig?.lint ?? true;

const resolveShouldRunDeadCode = (
  options: DiagnoseOptions,
  effectiveConfig: ReactDoctorConfig | null,
): boolean => options.deadCode ?? effectiveConfig?.deadCode ?? true;

const buildDiagnoseLayer = (input: DiagnoseLayerInput) => {
  const configLayer =
    input.configOverrideTarget === undefined
      ? Config.layerNode
      : Config.layerOf({
          config: input.config,
          resolvedDirectory: input.configOverrideTarget.resolvedDirectory,
          configSourceDirectory: input.configOverrideTarget.configSourceDirectory,
        });
  return Layer.mergeAll(
    Project.layerNode,
    configLayer,
    input.shouldRunDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]),
    Files.layerNode,
    Git.layerNode,
    input.shouldRunLint ? Linter.layerOxlint : Linter.layerOf([]),
    LintPartialFailures.layerLive,
    Progress.layerNoop,
    Reporter.layerNoop,
    Score.layerHttp,
    input.config?.supplyChain?.enabled !== false ? SupplyChain.layerNode : SupplyChain.layerOf([]),
  );
};

const buildInspectProgram = (
  scanTarget: ResolvedScanTarget,
  options: DiagnoseOptions,
  configOverride?: ReactDoctorConfig,
) => {
  const effectiveConfig = configOverride ?? scanTarget.userConfig;
  const includePaths = options.includePaths ?? [];
  const shouldRunDeadCode = resolveShouldRunDeadCode(options, effectiveConfig);

  return runInspect({
    directory: scanTarget.resolvedDirectory,
    includePaths,
    customRulesOnly: effectiveConfig?.customRulesOnly ?? false,
    respectInlineDisables:
      options.respectInlineDisables ?? effectiveConfig?.respectInlineDisables ?? true,
    warnings: options.warnings ?? effectiveConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    adoptExistingLintConfig: effectiveConfig?.adoptExistingLintConfig ?? true,
    ignoredTags: new Set(effectiveConfig?.ignore?.tags ?? []),
    runDeadCode: shouldRunDeadCode,
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
    reactDetected: hasReactRuntime(output.project),
    elapsedMilliseconds,
  };
};

const diagnoseDirectory = async (
  directory: string,
  options: DiagnoseOptions,
): Promise<DiagnoseResult> => {
  warnIfAiTrainingEnvironment();
  const startTime = globalThis.performance.now();
  const scanTarget = await resolveScanTarget(directory);
  const program = buildInspectProgram(scanTarget, options);
  const shouldRunLint = resolveShouldRunLint(options, scanTarget.userConfig);
  const shouldRunDeadCode = resolveShouldRunDeadCode(options, scanTarget.userConfig);

  const output: InspectOutput = await Effect.runPromise(
    restoreLegacyThrow(
      program.pipe(
        Effect.provide(
          buildDiagnoseLayer({
            config: scanTarget.userConfig,
            shouldRunLint,
            shouldRunDeadCode,
          }),
        ),
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
  batchConfig: ReactDoctorConfig | undefined,
): Promise<ProjectResult> => {
  const startTime = globalThis.performance.now();

  try {
    const scanTarget = await resolveScanTarget(projectDefinition.directory);
    const { directory: _, config: projectConfig, ...perProjectOptions } = projectDefinition;

    // Config layers, least to most specific: on-disk `doctor.config.*` ←
    // batch `config` ← per-project `config`. With no overrides the merge is
    // the identity and the orchestrator loads from disk (`Config.layerNode`).
    const didOverrideConfig = batchConfig !== undefined || projectConfig !== undefined;
    const effectiveConfig = mergeReactDoctorConfigs(
      mergeReactDoctorConfigs(scanTarget.userConfig, batchConfig),
      projectConfig,
    );
    const mergedOptions = { ...baseOptions, ...perProjectOptions };
    const shouldRunLint = resolveShouldRunLint(mergedOptions, effectiveConfig);
    const shouldRunDeadCode = resolveShouldRunDeadCode(mergedOptions, effectiveConfig);

    const program = buildInspectProgram(scanTarget, mergedOptions, effectiveConfig ?? undefined);
    // `plugins` is override-wins in the merge: when a caller layer supplies
    // it, relative entries resolve against the scan root (caller configs
    // have no file location); otherwise the on-disk config's directory.
    const didOverridePlugins =
      batchConfig?.plugins !== undefined || projectConfig?.plugins !== undefined;
    const diagnoseLayerInput: DiagnoseLayerInput = didOverrideConfig
      ? {
          config: effectiveConfig,
          shouldRunLint,
          shouldRunDeadCode,
          configOverrideTarget: {
            resolvedDirectory: scanTarget.resolvedDirectory,
            configSourceDirectory: didOverridePlugins ? null : scanTarget.configSourceDirectory,
          },
        }
      : {
          config: effectiveConfig,
          shouldRunLint,
          shouldRunDeadCode,
        };
    const layer = buildDiagnoseLayer(diagnoseLayerInput);

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

const diagnoseProjectBatch = async (
  input: DiagnoseProjectsInput,
): Promise<DiagnoseProjectsResult> => {
  warnIfAiTrainingEnvironment();
  const startTime = globalThis.performance.now();
  const { projects, concurrency, config: batchConfig, ...baseOptions } = input;

  // `diagnoseProject` never rejects (failures come back as `ok: false`),
  // so the pool always drains every project.
  const projectResults = await mapWithConcurrency(
    projects,
    concurrency ?? DEFAULT_PROJECT_SCAN_CONCURRENCY,
    (projectDefinition) => diagnoseProject(projectDefinition, baseOptions, batchConfig),
  );

  const succeededProjects = projectResults.filter((projectResult) => projectResult.ok);

  return {
    projects: projectResults,
    diagnostics: succeededProjects.flatMap((projectResult) => projectResult.diagnostics),
    score: findWorstScore(projectResults),
    ...(succeededProjects.length > 0
      ? { reactDetected: succeededProjects.some((projectResult) => projectResult.reactDetected) }
      : {}),
    elapsedMilliseconds: globalThis.performance.now() - startTime,
  };
};

interface Diagnose {
  /** Scan a single project directory and return diagnostics + score. */
  (directory: string, options?: DiagnoseOptions): Promise<DiagnoseResult>;
  /**
   * Scan multiple projects in parallel — each through the same pipeline as
   * the single-directory form — and return per-project results plus an
   * aggregate worst-of score. A failing project (e.g. no `package.json`)
   * comes back with `ok: false` instead of aborting the batch. Per-project
   * `config` layers on the batch `config`, which layers on each project's
   * on-disk config (see `mergeReactDoctorConfigs`).
   */
  (input: DiagnoseProjectsInput): Promise<DiagnoseProjectsResult>;
}

// HACK: the cast is required to assign the overload implementation (whose
// return type is the union of both signatures) to the overloaded interface
// — TypeScript can't verify that narrowing on the first argument selects
// the matching return type.
export const diagnose = (async (
  directoryOrInput: string | DiagnoseProjectsInput,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult | DiagnoseProjectsResult> =>
  typeof directoryOrInput === "string"
    ? diagnoseDirectory(directoryOrInput, options)
    : diagnoseProjectBatch(directoryOrInput)) as Diagnose;
