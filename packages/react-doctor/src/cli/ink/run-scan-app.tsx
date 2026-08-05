import path from "node:path";
import { performance } from "node:perf_hooks";
import { render } from "ink";
import * as Effect from "effect/Effect";
import {
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  highlighter,
  isPathInsideDirectory,
  mapWithConcurrency,
  remainingDeadlineBudgetMs,
  Reporter,
  resolveScanTarget,
  yieldToEventLoop,
} from "@react-doctor/core";
import type {
  BlockingLevel,
  Diagnostic,
  InspectResult,
  JsonReportSkippedProject,
  ReactDoctorConfig,
  ResolvedScanTarget,
  ScoreResult,
  WorkspacePackage,
} from "@react-doctor/core";
import { createInvocationInspect } from "../../inspect.js";
import type { ReactDoctorInspectOptions } from "../../inspect.js";
import { buildNoScoreMessage } from "../utils/build-no-score-message.js";
import { hasIncompleteScoreAnalysis } from "../utils/has-incomplete-score-analysis.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { registerActiveTuiRenderer } from "../utils/active-tui-renderer.js";
import { buildEmptyReportMessage } from "../utils/build-empty-report-message.js";
import { computeProjectedScore } from "../utils/compute-score-projection.js";
import { countUniqueScannedFiles } from "../utils/count-unique-scanned-files.js";
import { deduplicateProjectScans } from "../utils/deduplicate-project-scans.js";
import { collectProjectSourceFileCounts } from "../utils/collect-project-source-file-counts.js";
import { discoverWorkspacePackages, selectProjects } from "../utils/select-projects.js";
import { isCiEnvironment } from "../utils/is-ci-environment.js";
import { formatElapsedTime } from "../utils/format-elapsed-time.js";
import { pluralize } from "../utils/pluralize.js";
import { printDiagnosticsDump } from "../utils/print-diagnostics-dump.js";
import { printFooter } from "../utils/print-footer.js";
import { toForwardSlashes } from "../utils/path-format.js";
import { detectLaunchableAgents } from "../utils/detect-launchable-agents.js";
import { CLI_AGENT_BINARIES, launchCliAgent } from "../utils/launch-agent.js";
import { isReactDoctorWorkflowInstalled } from "../utils/install-github-workflow.js";
import { findNearestPackageDirectory } from "../utils/install-doctor-script.js";
import { hasLintHardFailure } from "../utils/has-lint-hard-failure.js";
import { setUpGitHubActions } from "../utils/set-up-github-actions.js";
import { recordCount, recordDistribution } from "../utils/record-metric.js";
import { resolveWorkspaceDeadCodeOwner } from "../utils/resolve-workspace-dead-code-owner.js";
import { retryMissingProjectScores } from "../utils/retry-missing-project-scores.js";
import { METRIC } from "../utils/constants.js";
import {
  filterScansForSurface,
  type SurfaceFilterableScan,
} from "../utils/filter-scans-for-surface.js";
import { isShareOptedOut } from "../utils/is-share-opted-out.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveBlockingLevel } from "../utils/resolve-blocking-level.js";
import { resolveProjectTuiScanScope } from "../utils/resolve-project-tui-scan-scope.js";
import { resolveProjectScan, type ResolvedProjectScan } from "../utils/resolve-project-scan.js";
import { resolveTuiScanScope, type TuiScanScopePlan } from "../utils/resolve-tui-scan-scope.js";
import { selectReportDiagnostics } from "../utils/select-report-diagnostics.js";
import { shouldFailScanGate } from "../utils/should-fail-scan-gate.js";
import { ProjectSelect } from "./components/project-select.js";
import { ScanApp } from "./scan-app.js";
import { progressLayerForStore, reporterLayerForStore } from "./scan-bridge-layers.js";
import { createScanStore } from "./scan-store.js";
import type {
  MultiProjectSummary,
  ScanReport,
  ScanStore,
  TuiHandoffRequest,
} from "./scan-store.js";

export interface RunScanAppInput {
  readonly directory: string;
  readonly flags?: InspectFlags;
  readonly scanTarget?: ResolvedScanTarget;
  readonly options?: ReactDoctorInspectOptions;
  readonly projectFlag?: string;
  readonly skipPrompts?: boolean;
  readonly configProjects?: readonly string[];
  readonly share?: boolean;
  readonly blocking?: string;
}

export interface RunScanAppResult {
  readonly shouldFail: boolean;
}

interface ScanPresentation {
  readonly isOffline: boolean;
  readonly initialProgress: string;
  readonly noScoreMessage: string;
  readonly outputDirectory?: string;
  readonly shouldRecommendCi: boolean;
  readonly verbose: boolean;
}

interface CompletedProjectScanOutcome {
  readonly status: "completed";
  readonly directory: string;
  readonly result: InspectResult;
  readonly config: ReactDoctorConfig | null;
}

interface SkippedProjectScanOutcome extends JsonReportSkippedProject {
  readonly status: "skipped";
}

const qualifyDiagnosticPaths = (
  diagnostics: ReadonlyArray<Diagnostic>,
  rootDirectory: string,
  projectDirectory: string,
): Diagnostic[] => {
  const prefix = path.relative(rootDirectory, projectDirectory);
  if (prefix === "" || prefix.startsWith("..")) return [...diagnostics];
  return diagnostics.map((diagnostic) =>
    path.isAbsolute(diagnostic.filePath)
      ? diagnostic
      : {
          ...diagnostic,
          filePath: toForwardSlashes(path.join(prefix, diagnostic.filePath)),
        },
  );
};

const resolveScanPresentation = (
  input: RunScanAppInput,
  projectScans: ReadonlyArray<ResolvedProjectScan>,
): ScanPresentation => {
  const isScoreDisabled =
    input.options?.noScore === true ||
    projectScans.some((projectScan) => projectScan.config?.noScore === true);
  return {
    isOffline:
      isCiEnvironment() ||
      input.share === false ||
      isShareOptedOut(projectScans, input.options?.noScore),
    initialProgress: projectScans.length > 1 ? "Indexing workspace files…" : "Scanning project…",
    noScoreMessage: buildNoScoreMessage({ isScoreDisabled }),
    outputDirectory: input.options?.outputDirectory,
    shouldRecommendCi:
      projectScans.length > 1 ||
      projectScans.some((projectScan) => isCiUnconfigured(projectScan.directory)),
    verbose: input.options?.verbose === true,
  };
};

const resolveTuiInspectOptions = (
  input: RunScanAppInput,
  config: ReactDoctorConfig | null,
): ReactDoctorInspectOptions => {
  const warnings = resolveCliInspectOptions(
    { blocking: input.blocking, warnings: input.options?.warnings },
    config,
  ).warnings;
  return warnings === undefined ? { ...input.options } : { ...input.options, warnings };
};

const resolveSelectedDirectories = async (
  rootDirectory: string,
  input: RunScanAppInput,
): Promise<string[]> => {
  const packages = discoverWorkspacePackages(rootDirectory);
  const needsPrompt =
    packages.length > 1 &&
    !input.projectFlag &&
    !input.skipPrompts &&
    (input.configProjects ?? []).length === 0 &&
    process.stdin.isTTY === true;

  if (!needsPrompt) {
    return selectProjects(
      rootDirectory,
      input.projectFlag,
      input.skipPrompts ?? false,
      input.configProjects,
    );
  }

  return promptProjectSelection(packages, rootDirectory);
};

const registerMountedTuiRenderer = (instance: ReturnType<typeof render>): (() => void) => {
  let didDisposeRenderer = false;
  const disposeRenderer = (shouldClearOutput: boolean): void => {
    if (didDisposeRenderer) return;
    didDisposeRenderer = true;
    if (shouldClearOutput) instance.clear();
    instance.unmount();
  };
  const unregisterActiveTuiRenderer = registerActiveTuiRenderer({
    preserveOutput: () => disposeRenderer(false),
  });
  return () => {
    unregisterActiveTuiRenderer();
    disposeRenderer(true);
  };
};

const promptProjectSelection = (
  packages: ReadonlyArray<WorkspacePackage>,
  rootDirectory: string,
): Promise<string[]> =>
  new Promise((resolve) => {
    let disposeRenderer = (): void => {};
    recordCount(METRIC.tuiProjectSelectShown);
    const instance = render(
      <ProjectSelect
        packages={packages}
        rootDirectory={rootDirectory}
        onSubmit={(directories) => {
          disposeRenderer();
          resolve(directories);
        }}
      />,
      { alternateScreen: true, exitOnCtrlC: false },
    );
    disposeRenderer = registerMountedTuiRenderer(instance);
  });

interface ScanReportInput {
  readonly result: InspectResult;
  readonly diagnostics?: ReadonlyArray<Diagnostic>;
  readonly rootDirectory: string;
  readonly projectedScore: number | null;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
  readonly emptyStateMessage: string;
}

const resolveLintFailureReason = (results: ReadonlyArray<InspectResult>): string | null => {
  for (const result of results) {
    if (!hasLintHardFailure(result)) continue;
    return result.skippedCheckReasons?.lint ?? "Lint failed before diagnostics were produced.";
  }
  return null;
};

const toScanReport = ({
  result,
  diagnostics,
  rootDirectory,
  projectedScore,
  isOffline,
  noScoreMessage,
  emptyStateMessage,
}: ScanReportInput): ScanReport => {
  const lintFailureReason = resolveLintFailureReason([result]);
  return {
    diagnostics: diagnostics ?? result.diagnostics,
    score: result.score,
    projectedScore,
    projectName: result.project.projectName,
    rootDirectory,
    scannedFileCount: result.scannedFileCount ?? 0,
    elapsedMilliseconds: result.elapsedMilliseconds,
    isOffline,
    noScoreMessage,
    emptyStateMessage,
    skippedChecks: result.skippedChecks,
    ...(lintFailureReason ? { lintFailureReason } : {}),
  };
};

interface ScoredDiagnosticReport {
  readonly score: ScoreResult | null;
  readonly scoreDiagnostics: ReadonlyArray<Diagnostic>;
}

interface AvailableScoreReport {
  readonly score: ScoreResult;
  readonly scoreDiagnostics: ReadonlyArray<Diagnostic>;
}

const findLowestScoredReport = (
  reports: ReadonlyArray<ScoredDiagnosticReport>,
): AvailableScoreReport | null => {
  let lowestScoredReport: AvailableScoreReport | null = null;
  for (const report of reports) {
    if (report.score === null) continue;
    if (lowestScoredReport === null || report.score.score < lowestScoredReport.score.score) {
      lowestScoredReport = { score: report.score, scoreDiagnostics: report.scoreDiagnostics };
    }
  }
  return lowestScoredReport;
};

const resolveEmptyStateMessage = (input: RunScanAppInput, demotedDiagnosticCount: number): string =>
  buildEmptyReportMessage({
    categoryFilters: input.options?.categoryFilters ?? [],
    demotedDiagnosticCount,
    outputSurface: input.options?.outputSurface ?? "cli",
  });

interface ExitFooterInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
  readonly isOffline: boolean;
  readonly lintFailureReason: string | null;
}

const printExitFooter = async (input: ExitFooterInput): Promise<void> => {
  process.stdout.write(
    `${highlighter.success("✔")} Scanned ${pluralize(input.scannedFileCount, "file")} in ${formatElapsedTime(input.elapsedMilliseconds)}\n`,
  );
  if (input.lintFailureReason !== null) {
    process.stdout.write(`${highlighter.warn("⚠")} Lint did not run: ${input.lintFailureReason}\n`);
  }
  await Effect.runPromise(
    printFooter({
      diagnostics: [...input.diagnostics],
      scoreResult: input.scoreResult,
      projectName: input.projectName,
      isOffline: input.isOffline,
    }),
  );
};

const performTuiHandoff = async (
  request: TuiHandoffRequest,
  rootDirectory: string,
): Promise<void> => {
  try {
    await launchCliAgent(request.agentId, request.prompt, rootDirectory);
  } catch {
    process.stdout.write(
      `${highlighter.warn("⚠")} Couldn't launch ${CLI_AGENT_BINARIES[request.agentId]}. Here's the prompt instead:\n`,
    );
    process.stdout.write(`${highlighter.dim("──── Agent prompt ────")}\n`);
    process.stdout.write(`${request.prompt}\n`);
    process.stdout.write(`${highlighter.dim("──────────────────────")}\n`);
  }
};

const isCiUnconfigured = (directory: string): boolean =>
  !isReactDoctorWorkflowInstalled(findNearestPackageDirectory(directory) ?? directory);

const performCiSetup = async (rootDirectory: string): Promise<void> => {
  const didCreateWorkflow = await setUpGitHubActions({ rootDirectory });
  recordCount(METRIC.agentHandoff, 1, {
    outcome: "ci-yes",
    source: "tui",
    created: didCreateWorkflow,
  });
};

interface PendingTuiActions {
  shouldSetUpCi: boolean;
  didQuit: boolean;
  handoffRequest: TuiHandoffRequest | null;
}

interface MountedScanApp {
  readonly store: ScanStore;
  readonly pendingActions: PendingTuiActions;
  readonly mountRenderer: (displayMode: "scan" | "report") => MountedTuiRenderer;
  readonly executePendingActions: () => Promise<void>;
}

interface MountedTuiRenderer {
  readonly instance: ReturnType<typeof render>;
  readonly dispose: () => void;
}

const mountScanApp = async (
  rootDirectory: string,
  shouldRecommendCi: boolean,
  initialProgress: string,
): Promise<MountedScanApp> => {
  const store = createScanStore();
  store.setProgress(initialProgress);
  const launchableAgents = await detectLaunchableAgents();
  const pendingActions: PendingTuiActions = {
    handoffRequest: null,
    shouldSetUpCi: false,
    didQuit: false,
  };
  const mountRenderer = (displayMode: "scan" | "report"): MountedTuiRenderer => {
    const instance = render(
      <ScanApp
        store={store}
        displayMode={displayMode}
        launchableAgents={launchableAgents}
        onHandoff={(request) => {
          pendingActions.handoffRequest = request;
        }}
        canAddToCi={shouldRecommendCi}
        onAddToCi={() => {
          pendingActions.shouldSetUpCi = true;
        }}
        onQuit={() => {
          pendingActions.didQuit = true;
        }}
      />,
      { alternateScreen: false, exitOnCtrlC: false },
    );
    return {
      instance,
      dispose: registerMountedTuiRenderer(instance),
    };
  };
  const executePendingActions = async (): Promise<void> => {
    if (pendingActions.shouldSetUpCi) await performCiSetup(rootDirectory);
    if (pendingActions.didQuit) return;
    if (pendingActions.handoffRequest) {
      await performTuiHandoff(pendingActions.handoffRequest, rootDirectory);
    }
  };
  return {
    store,
    pendingActions,
    mountRenderer,
    executePendingActions,
  };
};

interface ScanExecutionContext {
  readonly store: ReturnType<typeof createScanStore>;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
}

interface CompletedTuiScan {
  readonly scans: ReadonlyArray<SurfaceFilterableScan>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly diagnosticsAreGateExempt?: boolean;
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
}

interface ExecuteTuiScan {
  (context: ScanExecutionContext): Promise<CompletedTuiScan>;
}

const runMountedScan = async (
  rootDirectory: string,
  presentation: ScanPresentation,
  blockingLevel: BlockingLevel,
  executeScan: ExecuteTuiScan,
): Promise<RunScanAppResult> => {
  const { store, pendingActions, mountRenderer, executePendingActions } = await mountScanApp(
    rootDirectory,
    presentation.shouldRecommendCi,
    presentation.initialProgress,
  );
  let mountedRenderer = mountRenderer("scan");
  recordCount(METRIC.tuiScanInlineShown);
  const context: ScanExecutionContext = {
    store,
    ...presentation,
  };

  try {
    const completedScan = await executeScan(context);
    mountedRenderer.dispose();
    mountedRenderer = mountRenderer("report");
    await mountedRenderer.instance.waitUntilExit();
    mountedRenderer.dispose();
    if (presentation.outputDirectory !== undefined || presentation.verbose) {
      await Effect.runPromise(
        printDiagnosticsDump(
          [...completedScan.diagnostics],
          presentation.outputDirectory,
          presentation.verbose,
        ),
      );
    }
    if (!pendingActions.didQuit) {
      await printExitFooter({
        diagnostics: completedScan.diagnostics,
        scoreResult: completedScan.scoreResult,
        projectName: completedScan.projectName,
        scannedFileCount: completedScan.scannedFileCount,
        elapsedMilliseconds: completedScan.elapsedMilliseconds,
        isOffline: context.isOffline,
        lintFailureReason: resolveLintFailureReason(
          completedScan.scans.map(({ result }) => result),
        ),
      });
    }
    await executePendingActions();
    return {
      shouldFail: shouldFailScanGate({
        scans: completedScan.scans,
        blockingLevel,
        diagnosticsAreGateExempt: completedScan.diagnosticsAreGateExempt,
      }),
    };
  } catch (error) {
    mountedRenderer.dispose();
    throw error;
  }
};

const runSingleProjectScan = async (
  rootScanTarget: ResolvedScanTarget,
  projectDirectory: string,
  input: RunScanAppInput,
  scopePlan: TuiScanScopePlan,
  blockingLevel: BlockingLevel,
  inspectProject: ReturnType<typeof createInvocationInspect>,
): Promise<RunScanAppResult> => {
  const projectScan = await resolveProjectScan(rootScanTarget, projectDirectory);
  const isSupplyChainEnabled =
    input.options?.supplyChain ?? projectScan.config?.supplyChain?.enabled ?? true;
  const scopeOptions = resolveProjectTuiScanScope({
    plan: scopePlan,
    projectDirectory: projectScan.directory,
    rootDirectory: rootScanTarget.resolvedDirectory,
    supplyChainEnabled: isSupplyChainEnabled,
  });
  if (scopeOptions === null) {
    process.stdout.write("No changed source files in the selected project.\n");
    return { shouldFail: false };
  }
  const presentation = resolveScanPresentation(input, [projectScan]);
  return runMountedScan(projectScan.directory, presentation, blockingLevel, async (context) => {
    const result = await inspectProject(projectScan.directory, {
      ...resolveTuiInspectOptions(input, projectScan.config),
      ...scopeOptions,
      isCi: isCiEnvironment(),
      configOverride: projectScan.config,
      configSourceDirectory: projectScan.configSourceDirectory ?? undefined,
      uiLayers: {
        reporter: reporterLayerForStore(context.store),
        progress: progressLayerForStore(context.store),
      },
    });
    const reportSelection = selectReportDiagnostics({
      scan: { result, config: projectScan.config },
      categoryFilters: input.options?.categoryFilters,
      surface: input.options?.outputSurface,
    });
    const scoreDiagnostics = filterScansForSurface(
      [{ result, config: projectScan.config }],
      "score",
    );
    const projectedScore = result.score
      ? await computeProjectedScore(
          [...reportSelection.diagnostics],
          scoreDiagnostics,
          result.score,
        )
      : null;
    context.store.setReport(
      toScanReport({
        result,
        diagnostics: reportSelection.diagnostics,
        rootDirectory: projectScan.directory,
        projectedScore,
        isOffline: context.isOffline,
        noScoreMessage: buildNoScoreMessage({
          isScoreDisabled: input.options?.noScore === true || projectScan.config?.noScore === true,
          isAnalysisIncomplete: hasIncompleteScoreAnalysis(result.skippedChecks),
          disabledMessage: input.options?.scoreDisabledMessage,
        }),
        emptyStateMessage: resolveEmptyStateMessage(input, reportSelection.demotedDiagnosticCount),
      }),
    );
    return {
      scans: [{ result, config: projectScan.config }],
      diagnostics: reportSelection.diagnostics,
      diagnosticsAreGateExempt: scopePlan.baselineIntended && result.baselineDelta === undefined,
      scoreResult: result.score,
      projectName: result.project.projectName,
      scannedFileCount: result.scannedFileCount ?? 0,
      elapsedMilliseconds: result.elapsedMilliseconds,
    };
  });
};

const runMultiProjectScan = async (
  rootScanTarget: ResolvedScanTarget,
  directories: ReadonlyArray<string>,
  input: RunScanAppInput,
  scopePlan: TuiScanScopePlan,
  blockingLevel: BlockingLevel,
  inspectProject: ReturnType<typeof createInvocationInspect>,
): Promise<RunScanAppResult> => {
  const feedbackStartTime = performance.now();
  const rootDirectory = rootScanTarget.resolvedDirectory;
  const discoveredProjectScans = deduplicateProjectScans(
    await mapWithConcurrency(
      [...directories],
      DEFAULT_PROJECT_SCAN_CONCURRENCY,
      (projectDirectory) => resolveProjectScan(rootScanTarget, projectDirectory),
    ),
  );
  const projectScans = discoveredProjectScans.flatMap((projectScan) => {
    const isSupplyChainEnabled =
      input.options?.supplyChain ?? projectScan.config?.supplyChain?.enabled ?? true;
    const scopeOptions = resolveProjectTuiScanScope({
      plan: scopePlan,
      projectDirectory: projectScan.directory,
      rootDirectory,
      supplyChainEnabled: isSupplyChainEnabled,
    });
    return scopeOptions === null ? [] : [{ projectScan, scopeOptions }];
  });
  if (projectScans.length === 0) {
    process.stdout.write("No changed source files in the selected projects.\n");
    return { shouldFail: false };
  }
  const projectCount = projectScans.length;
  const rootProjectScan = discoveredProjectScans.find(
    (projectScan) => path.resolve(projectScan.directory) === path.resolve(rootDirectory),
  );
  const workspaceDeadCodeOwner = resolveWorkspaceDeadCodeOwner({
    rootDirectory,
    projectDirectories: discoveredProjectScans.map((projectScan) => projectScan.directory),
    isRootDeadCodeEnabled: input.options?.deadCode ?? rootProjectScan?.config?.deadCode ?? true,
  });
  if (workspaceDeadCodeOwner !== null) {
    recordCount(METRIC.scanWorkspaceDeadCodeShared, 1, {
      projectCount: discoveredProjectScans.length,
    });
  }
  const presentation = resolveScanPresentation(
    input,
    projectScans.map(({ projectScan }) => projectScan),
  );
  return runMountedScan(rootDirectory, presentation, blockingLevel, async (context) => {
    const startTime = performance.now();
    let finishedCount = 0;
    recordDistribution(METRIC.scanFeedbackDelay, performance.now() - feedbackStartTime, {
      unit: "millisecond",
      attributes: { surface: "tui", projectCount },
    });
    context.store.setProgress(`Scanning ${projectCount} projects…`);
    await yieldToEventLoop();
    const precomputedSourceFileCounts =
      scopePlan.scope === "full"
        ? await collectProjectSourceFileCounts(
            rootDirectory,
            projectScans.map(({ projectScan }) => projectScan.directory),
          )
        : null;
    const scanOutcomes = await mapWithConcurrency(
      projectScans,
      DEFAULT_PROJECT_SCAN_CONCURRENCY,
      async ({ projectScan, scopeOptions }) => {
        if (
          input.options?.deadlineEpochMs !== undefined &&
          remainingDeadlineBudgetMs(input.options.deadlineEpochMs) === 0
        ) {
          finishedCount += 1;
          context.store.setProgress(
            `Scanning ${projectCount} projects… (${finishedCount}/${projectCount})`,
          );
          return {
            status: "skipped",
            directory: projectScan.directory,
            reason: "max-duration",
          } satisfies SkippedProjectScanOutcome;
        }
        const projectLabel =
          path.relative(rootDirectory, projectScan.directory) || path.basename(rootDirectory);
        const formatProjectProgress = (displayText: string): string =>
          `Scanning ${projectCount} projects… (${finishedCount}/${projectCount}) · ${projectLabel}: ${displayText}`;
        const inspectOptions = resolveTuiInspectOptions(input, projectScan.config);
        const ownsWorkspaceDeadCode = projectScan.directory === workspaceDeadCodeOwner;
        const result = await inspectProject(projectScan.directory, {
          ...inspectOptions,
          ...scopeOptions,
          deadCode:
            workspaceDeadCodeOwner === null ? inspectOptions.deadCode : ownsWorkspaceDeadCode,
          isCi: isCiEnvironment(),
          configOverride: projectScan.config,
          configSourceDirectory: projectScan.configSourceDirectory ?? undefined,
          precomputedSourceFileCount: precomputedSourceFileCounts?.get(projectScan.directory),
          uiLayers: {
            reporter: Reporter.layerNoop,
            progress: progressLayerForStore(context.store, {
              transformText: formatProjectProgress,
              shouldClearOnStop: false,
            }),
          },
          concurrentScan: true,
          excludedProjectDirectories: discoveredProjectScans
            .filter((candidateProjectScan) =>
              isPathInsideDirectory(candidateProjectScan.directory, projectScan.directory),
            )
            .map((candidateProjectScan) => candidateProjectScan.directory),
          retainExcludedProjectDeadCodeDiagnostics: ownsWorkspaceDeadCode,
        });
        finishedCount += 1;
        context.store.setProgress(
          `Scanning ${projectCount} projects… (${finishedCount}/${projectCount})`,
        );
        await yieldToEventLoop();
        return {
          status: "completed",
          directory: projectScan.directory,
          result,
          config: projectScan.config,
        } satisfies CompletedProjectScanOutcome;
      },
    );
    const results = await retryMissingProjectScores(
      scanOutcomes
        .filter(
          (scanOutcome): scanOutcome is CompletedProjectScanOutcome =>
            scanOutcome.status === "completed",
        )
        .map((completedScan) => ({
          ...completedScan,
          isScoreDisabled: input.options?.noScore ?? completedScan.config?.noScore ?? false,
        })),
    );
    const skippedProjects = scanOutcomes
      .filter(
        (scanOutcome): scanOutcome is SkippedProjectScanOutcome => scanOutcome.status === "skipped",
      )
      .map(({ directory, reason }) => ({ directory, reason }))
      .sort((left, right) => left.directory.localeCompare(right.directory));
    if (skippedProjects.length > 0) {
      recordCount(METRIC.scanProjectSkipped, skippedProjects.length, {
        reason: "max-duration",
      });
    }

    const projectEntries = results.map(({ directory, result, config }) => {
      const reportSelection = selectReportDiagnostics({
        scan: { result, config },
        categoryFilters: input.options?.categoryFilters,
        surface: input.options?.outputSurface,
      });
      return {
        report: toScanReport({
          result,
          diagnostics: reportSelection.diagnostics,
          rootDirectory: directory,
          projectedScore: null,
          isOffline: context.isOffline,
          noScoreMessage: buildNoScoreMessage({
            isScoreDisabled: input.options?.noScore === true || config?.noScore === true,
            isAnalysisIncomplete: hasIncompleteScoreAnalysis(result.skippedChecks),
            disabledMessage: input.options?.scoreDisabledMessage,
          }),
          emptyStateMessage: resolveEmptyStateMessage(
            input,
            reportSelection.demotedDiagnosticCount,
          ),
        }),
        score: result.score,
        scoreDiagnostics: filterScansForSurface([{ result, config }], "score"),
        demotedDiagnosticCount: reportSelection.demotedDiagnosticCount,
      };
    });
    const projects = projectEntries.map(({ report }) => report);
    const combinedDiagnostics = projects.flatMap((project) =>
      qualifyDiagnosticPaths(project.diagnostics, rootDirectory, project.rootDirectory),
    );
    const lowestScoredReport = findLowestScoredReport(projectEntries);
    const projectedScore = lowestScoredReport
      ? await computeProjectedScore(
          combinedDiagnostics,
          [...lowestScoredReport.scoreDiagnostics],
          lowestScoredReport.score,
        )
      : null;
    const scannedFileCount = countUniqueScannedFiles(results.map(({ result }) => result));
    const elapsedMilliseconds = performance.now() - startTime;
    const lintFailureReason = resolveLintFailureReason(results.map(({ result }) => result));

    const summary: MultiProjectSummary = {
      projects,
      skippedProjects,
      aggregateScore: lowestScoredReport?.score ?? null,
      projectedScore,
      combinedDiagnostics,
      scannedFileCount,
      elapsedMilliseconds,
      projectName: path.basename(rootDirectory),
      rootDirectory,
      isOffline: context.isOffline,
      noScoreMessage: buildNoScoreMessage({
        isScoreDisabled:
          input.options?.noScore === true || results.some(({ config }) => config?.noScore === true),
        isAnalysisIncomplete: results.some(({ result }) =>
          hasIncompleteScoreAnalysis(result.skippedChecks),
        ),
        disabledMessage: input.options?.scoreDisabledMessage,
      }),
      emptyStateMessage: resolveEmptyStateMessage(
        input,
        projectEntries.reduce(
          (total, projectEntry) => total + projectEntry.demotedDiagnosticCount,
          0,
        ),
      ),
      ...(lintFailureReason ? { lintFailureReason } : {}),
    };
    context.store.setSummary(summary);
    return {
      scans: results,
      diagnostics: combinedDiagnostics,
      diagnosticsAreGateExempt:
        scopePlan.baselineIntended &&
        (skippedProjects.length > 0 ||
          results.length === 0 ||
          results.some(({ result }) => result.baselineDelta === undefined)),
      scoreResult: summary.aggregateScore,
      projectName: summary.projectName,
      scannedFileCount,
      elapsedMilliseconds,
    };
  });
};

export const runScanApp = async (input: RunScanAppInput): Promise<RunScanAppResult> => {
  const scanTarget =
    input.scanTarget ?? (await resolveScanTarget(input.directory, { allowAmbiguous: true }));
  const rootDirectory = scanTarget.resolvedDirectory;
  const scopePlan = await resolveTuiScanScope({
    directory: rootDirectory,
    flags: input.flags ?? {},
    userConfig: scanTarget.userConfig,
  });
  const deadlineEpochMs =
    input.options?.deadlineEpochMs ??
    (input.options?.maxDurationMs != null ? Date.now() + input.options.maxDurationMs : undefined);
  const resolvedInput: RunScanAppInput = {
    ...input,
    options: {
      ...input.options,
      deadlineEpochMs,
    },
    configProjects: input.configProjects ?? scanTarget.userConfig?.projects,
    share: input.share ?? scanTarget.userConfig?.share ?? true,
  };
  const selectedDirectories = await resolveSelectedDirectories(rootDirectory, resolvedInput);
  const inspectProject = createInvocationInspect(input.options?.concurrency);
  const blockingLevel = resolveBlockingLevel(
    { blocking: resolvedInput.blocking },
    scanTarget.userConfig,
  );

  if (selectedDirectories.length === 0) {
    return { shouldFail: false };
  }
  if (selectedDirectories.length === 1) {
    return runSingleProjectScan(
      scanTarget,
      selectedDirectories[0],
      resolvedInput,
      scopePlan,
      blockingLevel,
      inspectProject,
    );
  }
  return runMultiProjectScan(
    scanTarget,
    selectedDirectories,
    resolvedInput,
    scopePlan,
    blockingLevel,
    inspectProject,
  );
};
