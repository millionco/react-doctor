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
  ReactDoctorError,
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
  PackageJsonNotFoundError,
  ProjectNotFoundError,
} from "@react-doctor/project-info";
import type { DiagnoseOptions, DiagnoseResult } from "@react-doctor/types";

/**
 * Translates a tagged `ReactDoctorError` raised by the orchestrator
 * back into the legacy thrown class the public `diagnose()` contract
 * advertises. Adding a new public thrown class is one new `case`
 * here; everything inside the runtime keeps speaking in tagged
 * reasons.
 */
const restoreLegacyThrow = (error: ReactDoctorError): never => {
  const reason = error.reason;
  switch (reason._tag) {
    case "NoReactDependency":
      throw new NoReactDependencyError(reason.directory);
    case "ProjectNotFound":
      throw new ProjectNotFoundError(reason.directory);
    case "AmbiguousProject":
      throw new AmbiguousProjectError(reason.directory, reason.candidates);
    default:
      throw new Error(error.message);
  }
};

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

  let resolvedDirectory: string | null;
  try {
    resolvedDirectory = resolveDiagnoseTarget(directoryAfterRedirect);
  } catch (cause) {
    if (cause instanceof AmbiguousProjectError) throw cause;
    if (cause instanceof PackageJsonNotFoundError) throw cause;
    throw cause;
  }
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

  let output: InspectOutput;
  try {
    output = await Effect.runPromise(program.pipe(Effect.provide(buildLayerStack())));
  } catch (cause) {
    if (cause instanceof ReactDoctorError) restoreLegacyThrow(cause);
    throw cause;
  }

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
