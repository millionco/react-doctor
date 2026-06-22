import * as Effect from "effect/Effect";

// Env vars that signal an active AI/ML training pipeline or agent sandbox.
// Mirrors the CLI's detect-ai-training-environment.ts — kept inline so the
// API package has no dependency on the CLI package.
const AI_TRAINING_ENV_VARS = [
  "HF_DATASETS_CACHE", "HF_HOME", "HUGGINGFACE_HUB_CACHE",
  "CUDA_VISIBLE_DEVICES", "NVIDIA_VISIBLE_DEVICES",
  "WANDB_RUN_ID", "WANDB_SWEEP_ID", "MLFLOW_RUN_ID", "MLFLOW_TRACKING_URI",
  "COMET_EXPERIMENT_KEY", "NEPTUNE_RUN_ID", "CLEARML_TASK_ID",
  "RAY_WORKER_PROCESS", "RAY_ADDRESS",
  "MUJOCO_GL", "MUJOCO_PATH", "GYM_DISABLE_ENV_CHECKER",
  "SM_TRAINING_ENV", "TRAINING_JOB_ARN", "SAGEMAKER_BASE_DIR",
  "AZUREML_RUN_ID", "AZURE_ML_MODEL_DIR",
  "CLOUD_ML_PROJECT_ID", "VERTEX_AI_LOG_LEVEL",
  "KAGGLE_KERNEL_RUN_TYPE", "COLAB_BACKEND_VERSION", "DATABRICKS_RUNTIME_VERSION",
  "FLYTE_INTERNAL_EXECUTION_ID", "DET_MASTER", "LIGHTNING_USER_ID",
  "ARGO_WORKFLOW_NAME", "KFP_POD_NAME", "DVC_STAGE",
  "DAYTONA_WS_ID", "DAYTONA_WS_NAME", "E2B_SANDBOX_ID",
  "MODAL_FUNCTION_ID", "MODAL_TASK_ID", "RUNPOD_POD_ID",
  "SPACE_ID", "REPLICATE_USERNAME", "VAST_CONTAINERLABEL",
  "TPU_NAME", "ROCR_VISIBLE_DEVICES",
  "HARBOR_URL", "HARBOR_HOSTNAME",
  "SWE_BENCH_TASK", "SWEBENCH_TASK", "SWE_AGENT_MODEL",
] as const;

let didWarnAiTraining = false;
const warnIfAiTrainingEnvironment = (): void => {
  if (didWarnAiTraining) return;
  const detected = AI_TRAINING_ENV_VARS.find((envVar) => process.env[envVar] !== undefined);
  if (detected === undefined) return;
  didWarnAiTraining = true;
  console.warn(
    "[react-doctor] Use in an AI or ML pipeline requires written permission under the react-doctor license. Contact founders@million.dev to request access.",
  );
};
import * as Layer from "effect/Layer";
import {
  buildSkippedChecks,
  Config,
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  DEFAULT_SHOW_WARNINGS,
  DeadCode,
  Files,
  Git,
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

// The production layer stack for the programmatic API. The only axis that
// varies across calls is `Config`: with no override we load from disk
// (`Config.layerNode`); with a per-project override the caller's already
// resolved config drives `Config.layerOf(...)`. The supply-chain gate reads
// `supplyChain.enabled` from that same effective config (default on), so the
// one config input decides both. Every other service is identical, so the
// stack is built once here rather than duplicated per variant.
const buildDiagnoseLayer = (
  config: ReactDoctorConfig | null,
  configOverrideTarget?: Pick<ResolvedScanTarget, "resolvedDirectory" | "configSourceDirectory">,
) => {
  const configLayer =
    configOverrideTarget === undefined
      ? Config.layerNode
      : Config.layerOf({
          config,
          resolvedDirectory: configOverrideTarget.resolvedDirectory,
          configSourceDirectory: configOverrideTarget.configSourceDirectory,
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

const diagnoseDirectory = async (
  directory: string,
  options: DiagnoseOptions,
): Promise<DiagnoseResult> => {
  warnIfAiTrainingEnvironment();
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

    const program = buildInspectProgram(
      scanTarget,
      { ...baseOptions, ...perProjectOptions },
      effectiveConfig ?? undefined,
    );
    // `plugins` is override-wins in the merge: when a caller layer supplies
    // it, relative entries resolve against the scan root (caller configs
    // have no file location); otherwise the on-disk config's directory.
    const didOverridePlugins =
      batchConfig?.plugins !== undefined || projectConfig?.plugins !== undefined;
    const layer = buildDiagnoseLayer(
      effectiveConfig,
      didOverrideConfig
        ? {
            resolvedDirectory: scanTarget.resolvedDirectory,
            configSourceDirectory: didOverridePlugins ? null : scanTarget.configSourceDirectory,
          }
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

  return {
    projects: projectResults,
    diagnostics: projectResults.flatMap((projectResult) =>
      projectResult.ok ? projectResult.diagnostics : [],
    ),
    score: findWorstScore(projectResults),
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
