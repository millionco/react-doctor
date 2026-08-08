import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "./types/index.js";
import { MIN_SCAN_CONCURRENCY } from "./constants.js";
import { isReactDoctorError, type ReactDoctorError } from "./errors.js";
import { layerUserOtlp } from "./observability.js";
import { isProjectDiscoveryError } from "./project-info/index.js";
import { OxlintConcurrency } from "./refs.js";
import { runInspect, type InspectOutput } from "./run-inspect.js";
import { messageFromUnknown } from "./utils/message-from-unknown.js";
import { Config, type ResolvedConfig } from "./services/config.js";
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

interface EditorScanSettings {
  readonly lint: boolean;
  readonly runDeadCode: boolean;
  readonly respectInlineDisables: boolean;
  readonly adoptExistingLintConfig: boolean;
  readonly customRulesOnly: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly warnings: boolean;
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

const resolveBooleanSetting = (
  override: boolean | undefined,
  configured: boolean | undefined,
  defaultValue: boolean,
): boolean => {
  if (override !== undefined) return override;
  if (configured !== undefined) return configured;
  return defaultValue;
};

const resolveEditorScanSettings = (
  input: EditorScanInput,
  userConfig: ReactDoctorConfig | null,
): EditorScanSettings => ({
  lint: resolveBooleanSetting(input.lint, userConfig?.lint, true),
  runDeadCode: resolveBooleanSetting(input.runDeadCode, undefined, false),
  respectInlineDisables: resolveBooleanSetting(
    input.respectInlineDisables,
    userConfig?.respectInlineDisables,
    true,
  ),
  adoptExistingLintConfig: resolveBooleanSetting(
    undefined,
    userConfig?.adoptExistingLintConfig,
    true,
  ),
  customRulesOnly: resolveBooleanSetting(undefined, userConfig?.customRulesOnly, false),
  ignoredTags: new Set(userConfig?.ignore?.tags),
  warnings: resolveBooleanSetting(undefined, userConfig?.warnings, true),
});

const editorScanResultFromOutput = (output: InspectOutput): EditorScanResult => ({
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
});

const failedEditorScanResult = (input: EditorScanInput, error: unknown): EditorScanResult => ({
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
  error: messageFromUnknown(error),
});

const editorScanResultFromExit = (
  input: EditorScanInput,
  exit: Exit.Exit<InspectOutput, ReactDoctorError>,
): EditorScanResult => {
  if (Exit.isSuccess(exit)) return editorScanResultFromOutput(exit.value);
  const error: unknown = Cause.squash(exit.cause);
  if (isGracefulSkip(error)) return skippedResult(input.directory);
  return failedEditorScanResult(input, error);
};

const resolveEditorConfig = (input: EditorScanInput): Effect.Effect<ResolvedConfig> => {
  if (input.configOverride !== undefined) {
    return Effect.succeed({
      config: input.configOverride,
      resolvedDirectory: input.directory,
      configSourceDirectory: input.configSourceDirectory ?? null,
    });
  }
  return Effect.gen(function* () {
    const configService = yield* Config;
    return yield* configService.resolve(input.directory);
  }).pipe(Effect.provide(Config.layerNode));
};

const runEditorScanEffect = (input: EditorScanInput): Effect.Effect<EditorScanResult> =>
  Effect.gen(function* () {
    const resolvedConfig = yield* resolveEditorConfig(input);
    const userConfig = resolvedConfig.config;
    const settings = resolveEditorScanSettings(input, userConfig);
    yield* Effect.annotateCurrentSpan({
      "editor.lint": settings.lint,
      "editor.runDeadCode": settings.runDeadCode,
    });

    const layers = Layer.mergeAll(
      Project.layerNode,
      Config.layerOf(resolvedConfig),
      Files.layerNode,
      Git.layerOf({}),
      settings.lint ? Linter.layerOxlint : Linter.layerOf([]),
      LintPartialFailures.layerLive,
      settings.runDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Layer.succeed(OxlintConcurrency, MIN_SCAN_CONCURRENCY),
    );

    const exit = yield* Effect.exit(
      runInspect({
        directory: input.directory,
        includePaths: input.includePaths ?? [],
        customRulesOnly: settings.customRulesOnly,
        respectInlineDisables: settings.respectInlineDisables,
        adoptExistingLintConfig: settings.adoptExistingLintConfig,
        ignoredTags: settings.ignoredTags,
        ...(input.nodeBinaryPath !== undefined ? { nodeBinaryPath: input.nodeBinaryPath } : {}),
        runDeadCode: settings.runDeadCode,
        warnings: settings.warnings,
        isCi: false,
        resolveLocalGithubViewerPermission: false,
        skipExplicitIncludePathFilter: true,
      }).pipe(Effect.provide(layers)),
    );

    return editorScanResultFromExit(input, exit);
  }).pipe(Effect.withSpan("runEditorScan"));

export const runEditorScan = (input: EditorScanInput): Promise<EditorScanResult> =>
  Effect.runPromise(runEditorScanEffect(input).pipe(Effect.provide(layerUserOtlp)));
