import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "./types/index.js";
import { MIN_SCAN_CONCURRENCY } from "./constants.js";
import { isReactDoctorError } from "./errors.js";
import { loadConfigWithSource } from "./load-config.js";
import { layerOtlp } from "./observability.js";
import { isProjectDiscoveryError } from "./project-info/index.js";
import { OxlintConcurrency } from "./refs.js";
import { runInspect } from "./run-inspect.js";
import { Config } from "./services/config.js";
import { DeadCode } from "./services/dead-code.js";
import { Files } from "./services/files.js";
import { Git } from "./services/git.js";
import { Linter, LintPartialFailures } from "./services/linter.js";
import { Progress } from "./services/progress.js";
import { Project } from "./services/project.js";
import { Reporter } from "./services/reporter.js";
import { Score } from "./services/score.js";
import { SupplyChain } from "./services/supply-chain.js";

/**
 * Plain-Promise scan tailored for long-lived editor integrations (the
 * language server). It runs the canonical `runInspect` orchestrator but
 * with editor-appropriate layers: no hosted Score network call
 * (`Score.layerOf(null)`), no git subprocess metadata
 * (`Git.layerOf({})`), and a no-op `Progress` / `Reporter`. All Effect
 * wiring stays inside `@react-doctor/core`, so editor packages depend on
 * a plain async function instead of pulling the Effect runtime into
 * their own dependency graph.
 */
export interface EditorScanInput {
  /** Project directory to scan (already resolved to a React project root). */
  readonly directory: string;
  /**
   * Source files to lint, relative to `directory`. Empty / omitted runs
   * a whole-project scan. Linted verbatim (no JSX-only narrowing) so the
   * exact buffer the user edits is analyzed regardless of extension.
   */
  readonly includePaths?: ReadonlyArray<string>;
  /** Run dead-code analysis alongside lint. Defaults to `false` (file scans). */
  readonly runDeadCode?: boolean;
  /** Run the linter. Defaults to `true`. Set `false` to skip oxlint entirely. */
  readonly lint?: boolean;
  /** Honor inline `// react-doctor-disable*` comments. Defaults to config / `true`. */
  readonly respectInlineDisables?: boolean;
  /** Node binary able to load the oxlint native binding (from `NodeResolver`). */
  readonly nodeBinaryPath?: string;
  /**
   * Pre-resolved config override. When provided, the on-disk
   * `react-doctor.config.json` is not loaded for this scan.
   */
  readonly configOverride?: ReactDoctorConfig | null;
  /** Source directory of `configOverride` (anchors `config.plugins` resolution). */
  readonly configSourceDirectory?: string | null;
}

export interface EditorScanResult {
  /** `true` when the scan produced a usable result (including a graceful skip). */
  readonly ok: boolean;
  /** `true` when the directory is not an analyzable React project. */
  readonly skipped: boolean;
  readonly diagnostics: Diagnostic[];
  readonly project: ProjectInfo | null;
  readonly resolvedDirectory: string;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  readonly lintPartialFailures: string[];
  /** Human-readable failure message when `ok` is `false`. */
  readonly error: string | null;
}

const skippedResult = (directory: string): EditorScanResult => ({
  ok: true,
  skipped: true,
  diagnostics: [],
  project: null,
  resolvedDirectory: directory,
  didLintFail: false,
  lintFailureReason: null,
  didDeadCodeFail: false,
  deadCodeFailureReason: null,
  lintPartialFailures: [],
  error: null,
});

const isGracefulSkip = (error: unknown): boolean => {
  if (isProjectDiscoveryError(error)) return true;
  if (isReactDoctorError(error)) {
    const tag = error.reason._tag;
    return tag === "NoReactDependency" || tag === "ProjectNotFound" || tag === "AmbiguousProject";
  }
  return false;
};

export const runEditorScan = async (input: EditorScanInput): Promise<EditorScanResult> => {
  const hasConfigOverride = input.configOverride !== undefined;
  const loaded = hasConfigOverride ? null : await loadConfigWithSource(input.directory);
  const userConfig = hasConfigOverride ? (input.configOverride ?? null) : (loaded?.config ?? null);

  const lint = input.lint ?? userConfig?.lint ?? true;
  const runDeadCode = input.runDeadCode ?? false;
  const respectInlineDisables =
    input.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true;
  const adoptExistingLintConfig = userConfig?.adoptExistingLintConfig ?? true;
  const customRulesOnly = userConfig?.customRulesOnly ?? false;
  const ignoredTags = new Set(userConfig?.ignore?.tags ?? []);
  // Editors surface warnings (like ESLint in-editor); the CLI's
  // hide-warnings-by-default is a terminal-output choice. An explicit
  // `warnings: false` in config still wins for users who opt out globally.
  const warnings = userConfig?.warnings ?? true;

  const configLayer = hasConfigOverride
    ? Config.layerOf({
        config: userConfig,
        resolvedDirectory: input.directory,
        configSourceDirectory: input.configSourceDirectory ?? null,
      })
    : Config.layerNode;

  const layers = Layer.mergeAll(
    Project.layerNode,
    configLayer,
    Files.layerNode,
    // Editor scans never need git metadata; the null snapshot avoids a
    // subprocess spawn per keystroke.
    Git.layerOf({}),
    lint ? Linter.layerOxlint : Linter.layerOf([]),
    LintPartialFailures.layerLive,
    runDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]),
    Progress.layerNoop,
    Reporter.layerNoop,
    // No hosted score lookup in the editor — keep scans offline and fast.
    Score.layerOf(null),
    // No Socket.dev network lookups in the editor either — keep scans offline.
    SupplyChain.layerOf([]),
    // Pin oxlint to a single subprocess per editor scan. Core lints in
    // parallel by default (auto-detect cores), but the language server
    // already parallelizes at the scheduler level — one oxlint process per
    // file/chunk, many chunks running at once. Letting each individual scan
    // also fan out across cores would oversubscribe the machine (scheduler
    // concurrency × per-scan workers). Serial here preserves the "one oxlint
    // process per runEditorScan" invariant the chunked scheduler is built on.
    Layer.succeed(OxlintConcurrency, MIN_SCAN_CONCURRENCY),
  );

  const program = runInspect({
    directory: input.directory,
    includePaths: input.includePaths ?? [],
    customRulesOnly,
    respectInlineDisables,
    adoptExistingLintConfig,
    ignoredTags,
    ...(input.nodeBinaryPath !== undefined ? { nodeBinaryPath: input.nodeBinaryPath } : {}),
    runDeadCode,
    warnings,
    isCi: false,
    resolveLocalGithubViewerPermission: false,
    skipJsxIncludeFilter: true,
    // `layerOtlp` is a no-op unless REACT_DOCTOR_OTLP_ENDPOINT +
    // REACT_DOCTOR_OTLP_AUTH_HEADER are set; when they are, every
    // `runInspect` / `Service.method` span from this scan is exported,
    // giving editor scans the same observability as the CLI.
  }).pipe(Effect.provide(layers), Effect.provide(layerOtlp));

  const exit = await Effect.runPromiseExit(program);

  if (Exit.isSuccess(exit)) {
    const output = exit.value;
    return {
      ok: true,
      skipped: false,
      diagnostics: [...output.diagnostics],
      project: output.project,
      resolvedDirectory: output.resolvedDirectory,
      didLintFail: output.didLintFail,
      lintFailureReason: output.lintFailureReason,
      didDeadCodeFail: output.didDeadCodeFail,
      deadCodeFailureReason: output.deadCodeFailureReason,
      lintPartialFailures: [...output.lintPartialFailures],
      error: null,
    };
  }

  // `squash` collapses the cause to a single value: the first typed
  // `Effect.fail(ReactDoctorError)`, else the first defect (e.g. a
  // synchronous `PackageJsonNotFoundError` thrown during discovery).
  const error: unknown = Cause.squash(exit.cause);

  if (isGracefulSkip(error)) {
    return skippedResult(input.directory);
  }

  return {
    ok: false,
    skipped: false,
    diagnostics: [],
    project: null,
    resolvedDirectory: input.directory,
    didLintFail: false,
    lintFailureReason: null,
    didDeadCodeFail: false,
    deadCodeFailureReason: null,
    lintPartialFailures: [],
    error: error instanceof Error ? error.message : String(error),
  };
};
