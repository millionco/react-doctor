import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import path from "node:path";
import {
  Config,
  DeadCode,
  Files,
  Git,
  layerOtlp,
  Linter,
  Project,
  Reporter,
  resolveScanPlan,
  runInspect,
  Score,
  type InspectOutput,
} from "@react-doctor/core";
import {
  AmbiguousProjectError,
  NoReactDependencyError,
  ProjectNotFoundError,
} from "@react-doctor/core";
import type { DiagnoseOptions, DiagnoseResult, ResolvedScanPlan } from "@react-doctor/core";

const buildLayerStack = (scanPlan: ResolvedScanPlan) =>
  Layer.mergeAll(
    Project.layerNode,
    Config.layerOf({
      config: scanPlan.userConfig,
      resolvedDirectory: scanPlan.resolvedDirectory ?? scanPlan.directoryAfterRootDir,
      configSourceDirectory: scanPlan.configSourceDirectory,
    }),
    Files.layerNode,
    Git.layerNode,
    Linter.layerOxlint,
    DeadCode.layerNode,
    Score.layerHttp,
    Reporter.layerNoop,
  );

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const startTime = globalThis.performance.now();
  const requestedDirectory = path.resolve(directory);
  const scanPlan = resolveScanPlan({
    directory: requestedDirectory,
    options,
    shouldResolveDiagnoseTarget: true,
  });
  const resolvedDirectory = scanPlan.resolvedDirectory;

  if (!resolvedDirectory) {
    throw new ProjectNotFoundError(scanPlan.directoryAfterRootDir);
  }

  const program = runInspect({
    directory: resolvedDirectory,
    includePaths: scanPlan.options.includePaths,
    customRulesOnly: scanPlan.options.customRulesOnly,
    respectInlineDisables: scanPlan.options.respectInlineDisables,
    adoptExistingLintConfig: scanPlan.options.adoptExistingLintConfig,
    ignoredTags: scanPlan.options.ignoredTags,
    runDeadCode: scanPlan.options.deadCode,
    isCi: false,
  });

  // v4 idiom: `Effect.catchReasons` dispatches on the tagged-reason
  // sub-channel without manual `instanceof` checks. Each handler
  // converts a tagged reason into the legacy thrown class the public
  // `diagnose()` contract advertises (via `Effect.die`, which the
  // surrounding `Effect.runPromise` re-throws unchanged). The
  // `orElse` branch preserves the legacy "anything else throws as a
  // plain `Error` with the tagged-class message string" contract for
  // grep-stderr callers.
  const output: InspectOutput = await Effect.runPromise(
    program.pipe(
      Effect.provide(buildLayerStack(scanPlan)),
      // Opt-in OTLP exporter. No-op unless REACT_DOCTOR_OTLP_ENDPOINT
      // + REACT_DOCTOR_OTLP_AUTH_HEADER are set in the environment;
      // see `core/observability.ts` for the env-driven config.
      Effect.provide(layerOtlp),
      Effect.catchReasons(
        "ReactDoctorError",
        {
          NoReactDependency: (reason) => Effect.die(new NoReactDependencyError(reason.directory)),
          ProjectNotFound: (reason) => Effect.die(new ProjectNotFoundError(reason.directory)),
          AmbiguousProject: (reason) =>
            Effect.die(new AmbiguousProjectError(reason.directory, [...reason.candidates])),
        },
        (_reason, error) => Effect.die(new Error(error.message)),
      ),
    ),
  );

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
    elapsedMilliseconds: globalThis.performance.now() - startTime,
  };
};
