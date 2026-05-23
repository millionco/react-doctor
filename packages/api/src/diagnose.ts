import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import path from "node:path";
import {
  Config,
  DeadCode,
  Files,
  Linter,
  LintPartialFailures,
  loadConfigWithSource,
  Project,
  Reporter,
  resolveConfigRootDir,
  resolveDiagnoseTarget,
  runInspect,
  Score,
  type InspectOutput,
} from "@react-doctor/core";
import {
  AmbiguousProjectError,
  NoReactDependencyError,
  ProjectNotFoundError,
} from "@react-doctor/core";
import type { DiagnoseOptions, DiagnoseResult } from "@react-doctor/core";

const buildLayerStack = () =>
  Layer.mergeAll(
    Project.layerNode,
    Config.layerNode,
    Files.layerNode,
    Linter.layerOxlint,
    LintPartialFailures.layerLive,
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

  /**
   * Pre-resolve the rootDir redirect + auto-fallback to nested React
   * subprojects BEFORE handing off to runInspect. These two
   * directory-shape concerns predate the project-discovery boundary:
   * the rootDir redirect happens against the config (which lives at
   * the requested directory), and resolveDiagnoseTarget walks down to
   * find a nested React project when the requested directory itself
   * lacks a package.json. runInspect itself only knows "go discover
   * the project at this directory".
   */
  const initialLoadedConfig = loadConfigWithSource(requestedDirectory);
  const redirectedDirectory = resolveConfigRootDir(
    initialLoadedConfig?.config ?? null,
    initialLoadedConfig?.sourceDirectory ?? null,
  );
  const directoryAfterRedirect = redirectedDirectory ?? requestedDirectory;

  // resolveDiagnoseTarget throws AmbiguousProjectError when the
  // requested directory has multiple React subprojects; let it
  // propagate so the legacy public-API contract holds. A `null`
  // return means "no React project here" — translate that to the
  // ProjectNotFoundError the legacy diagnose() used.
  const resolvedDirectory = resolveDiagnoseTarget(directoryAfterRedirect);
  if (!resolvedDirectory) {
    throw new ProjectNotFoundError(directoryAfterRedirect);
  }

  const includePaths = options.includePaths ?? [];

  const program = runInspect({
    directory: resolvedDirectory,
    includePaths,
    customRulesOnly: initialLoadedConfig?.config?.customRulesOnly ?? false,
    respectInlineDisables:
      options.respectInlineDisables ?? initialLoadedConfig?.config?.respectInlineDisables ?? true,
    adoptExistingLintConfig: initialLoadedConfig?.config?.adoptExistingLintConfig ?? true,
    ignoredTags: new Set(initialLoadedConfig?.config?.ignore?.tags ?? []),
    runDeadCode: options.deadCode ?? initialLoadedConfig?.config?.deadCode ?? true,
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
      Effect.provide(buildLayerStack()),
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
