import path from "node:path";
import { performance } from "node:perf_hooks";
import { render } from "ink";
import * as Effect from "effect/Effect";
import {
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  highlighter,
  mapWithConcurrency,
  mergeReactDoctorConfigs,
  Reporter,
  resolveScanTarget,
} from "@react-doctor/core";
import type {
  BlockingLevel,
  Diagnostic,
  InspectResult,
  ReactDoctorConfig,
  ResolvedScanTarget,
  ScoreResult,
  WorkspacePackage,
} from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import type { ReactDoctorInspectOptions } from "../../inspect.js";
import { buildNoScoreMessage } from "../utils/build-no-score-message.js";
import { computeProjectedScore } from "../utils/compute-score-projection.js";
import { countUniqueScannedFiles } from "../utils/count-unique-scanned-files.js";
import { discoverWorkspacePackages, selectProjects } from "../utils/select-projects.js";
import { isCiEnvironment } from "../utils/is-ci-environment.js";
import { formatElapsedTime } from "../utils/render-diagnostics.js";
import { printFooter } from "../utils/render-summary.js";
import { toForwardSlashes } from "../utils/path-format.js";
import { detectLaunchableAgents } from "../utils/detect-launchable-agents.js";
import { CLI_AGENT_BINARIES, launchCliAgent } from "../utils/launch-agent.js";
import { isReactDoctorWorkflowInstalled } from "../utils/install-github-workflow.js";
import { findNearestPackageDirectory } from "../utils/install-doctor-script.js";
import { hasLintHardFailure } from "../utils/has-lint-hard-failure.js";
import { setUpGitHubActions } from "../utils/set-up-github-actions.js";
import { recordCount } from "../utils/record-metric.js";
import { METRIC } from "../utils/constants.js";
import type { SurfaceFilterableScan } from "../utils/filter-scans-for-surface.js";
import { isShareOptedOut } from "../utils/is-share-opted-out.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveBlockingLevel } from "../utils/resolve-blocking-level.js";
import { shouldFailScanGate } from "../utils/should-fail-scan-gate.js";
import { ProjectSelect } from "./components/project-select.js";
import { ScanApp } from "./scan-app.js";
import { progressLayerForStore, reporterLayerForStore } from "./scan-bridge-layers.js";
import { createScanStore } from "./scan-store.js";
import type { MultiProjectSummary, ScanReport, TuiHandoffRequest } from "./scan-store.js";

export interface RunScanAppInput {
  readonly directory: string;
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

interface ResolvedProjectScan {
  readonly directory: string;
  readonly config: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
}

interface ScanPresentation {
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
}

const resolveProjectScan = async (
  rootScanTarget: ResolvedScanTarget,
  projectDirectory: string,
): Promise<ResolvedProjectScan> => {
  const projectScanTarget =
    projectDirectory === rootScanTarget.resolvedDirectory
      ? rootScanTarget
      : await resolveScanTarget(projectDirectory, { allowAmbiguous: true });
  const config =
    projectDirectory === rootScanTarget.resolvedDirectory
      ? rootScanTarget.userConfig
      : mergeReactDoctorConfigs(
          rootScanTarget.userConfig,
          projectScanTarget.userConfig ?? undefined,
        );
  const configSourceDirectory =
    projectScanTarget.userConfig?.plugins === undefined
      ? rootScanTarget.configSourceDirectory
      : projectScanTarget.configSourceDirectory;
  return {
    directory: projectScanTarget.resolvedDirectory,
    config,
    configSourceDirectory,
  };
};

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
    noScoreMessage: buildNoScoreMessage(isScoreDisabled),
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

const promptProjectSelection = (
  packages: ReadonlyArray<WorkspacePackage>,
  rootDirectory: string,
): Promise<string[]> =>
  new Promise((resolve) => {
    const instance = render(
      <ProjectSelect
        packages={packages}
        rootDirectory={rootDirectory}
        onSubmit={(directories) => {
          instance.clear();
          instance.unmount();
          resolve(directories);
        }}
      />,
      { exitOnCtrlC: false },
    );
  });

interface ScanReportInput {
  readonly result: InspectResult;
  readonly rootDirectory: string;
  readonly projectedScore: number | null;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
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
  rootDirectory,
  projectedScore,
  isOffline,
  noScoreMessage,
}: ScanReportInput): ScanReport => {
  const lintFailureReason = resolveLintFailureReason([result]);
  return {
    diagnostics: result.diagnostics,
    score: result.score,
    projectedScore,
    projectName: result.project.projectName,
    rootDirectory,
    scannedFileCount: result.scannedFileCount ?? 0,
    elapsedMilliseconds: result.elapsedMilliseconds,
    isOffline,
    noScoreMessage,
    ...(lintFailureReason ? { lintFailureReason } : {}),
  };
};

const findLowestScored = (
  reports: ReadonlyArray<{ score: ScoreResult | null; diagnostics: ReadonlyArray<Diagnostic> }>,
): { score: ScoreResult; diagnostics: ReadonlyArray<Diagnostic> } | null => {
  let worst: { score: ScoreResult; diagnostics: ReadonlyArray<Diagnostic> } | null = null;
  for (const report of reports) {
    if (report.score === null) continue;
    if (worst === null || report.score.score < worst.score.score) {
      worst = { score: report.score, diagnostics: report.diagnostics };
    }
  }
  return worst;
};

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
  const fileLabel = input.scannedFileCount === 1 ? "file" : "files";
  process.stdout.write(
    `${highlighter.success("✔")} Scanned ${input.scannedFileCount} ${fileLabel} in ${formatElapsedTime(input.elapsedMilliseconds)}\n`,
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

const mountScanApp = async (rootDirectory: string) => {
  const store = createScanStore();
  const launchableAgents = await detectLaunchableAgents();
  const pending: { handoff: TuiHandoffRequest | null; ciSetup: boolean } = {
    handoff: null,
    ciSetup: false,
  };
  const instance = render(
    <ScanApp
      store={store}
      launchableAgents={launchableAgents}
      onHandoff={(request) => {
        pending.handoff = request;
      }}
      canAddToCi={isCiUnconfigured(rootDirectory)}
      onAddToCi={() => {
        pending.ciSetup = true;
      }}
    />,
    { exitOnCtrlC: false },
  );
  const settle = async (): Promise<void> => {
    if (pending.ciSetup) await performCiSetup(rootDirectory);
    if (pending.handoff) await performTuiHandoff(pending.handoff, rootDirectory);
  };
  return { store, instance, settle };
};

interface ScanExecutionContext {
  readonly store: ReturnType<typeof createScanStore>;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
}

interface CompletedTuiScan {
  readonly scans: ReadonlyArray<SurfaceFilterableScan>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
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
  const { store, instance, settle } = await mountScanApp(rootDirectory);
  const context: ScanExecutionContext = {
    store,
    ...presentation,
  };

  try {
    const completedScan = await executeScan(context);
    await instance.waitUntilExit();
    await printExitFooter({
      diagnostics: completedScan.diagnostics,
      scoreResult: completedScan.scoreResult,
      projectName: completedScan.projectName,
      scannedFileCount: completedScan.scannedFileCount,
      elapsedMilliseconds: completedScan.elapsedMilliseconds,
      isOffline: context.isOffline,
      lintFailureReason: resolveLintFailureReason(completedScan.scans.map(({ result }) => result)),
    });
    await settle();
    return {
      shouldFail: shouldFailScanGate({ scans: completedScan.scans, blockingLevel }),
    };
  } catch (error) {
    instance.unmount();
    throw error;
  }
};

const runSingleProjectScan = async (
  rootScanTarget: ResolvedScanTarget,
  projectDirectory: string,
  input: RunScanAppInput,
  blockingLevel: BlockingLevel,
): Promise<RunScanAppResult> => {
  const projectScan = await resolveProjectScan(rootScanTarget, projectDirectory);
  const presentation = resolveScanPresentation(input, [projectScan]);
  return runMountedScan(projectScan.directory, presentation, blockingLevel, async (context) => {
    const result = await inspect(projectScan.directory, {
      ...resolveTuiInspectOptions(input, projectScan.config),
      isCi: isCiEnvironment(),
      configOverride: projectScan.config,
      configSourceDirectory: projectScan.configSourceDirectory ?? undefined,
      uiLayers: {
        reporter: reporterLayerForStore(context.store),
        progress: progressLayerForStore(context.store),
      },
    });
    const projectedScore = result.score
      ? await computeProjectedScore([...result.diagnostics], [...result.diagnostics], result.score)
      : null;
    context.store.setReport(
      toScanReport({
        result,
        rootDirectory: projectScan.directory,
        projectedScore,
        isOffline: context.isOffline,
        noScoreMessage: context.noScoreMessage,
      }),
    );
    return {
      scans: [{ result, config: projectScan.config }],
      diagnostics: result.diagnostics,
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
  blockingLevel: BlockingLevel,
): Promise<RunScanAppResult> => {
  const rootDirectory = rootScanTarget.resolvedDirectory;
  const projectScans = await mapWithConcurrency(
    [...directories],
    DEFAULT_PROJECT_SCAN_CONCURRENCY,
    (projectDirectory) => resolveProjectScan(rootScanTarget, projectDirectory),
  );
  const presentation = resolveScanPresentation(input, projectScans);
  return runMountedScan(rootDirectory, presentation, blockingLevel, async (context) => {
    const startTime = performance.now();
    let finishedCount = 0;
    context.store.setProgress(`Scanning ${directories.length} projects…`);
    const results = await mapWithConcurrency(
      projectScans,
      DEFAULT_PROJECT_SCAN_CONCURRENCY,
      async (projectScan) => {
        const result = await inspect(projectScan.directory, {
          ...resolveTuiInspectOptions(input, projectScan.config),
          isCi: isCiEnvironment(),
          configOverride: projectScan.config,
          configSourceDirectory: projectScan.configSourceDirectory ?? undefined,
          uiLayers: { reporter: Reporter.layerNoop },
          concurrentScan: true,
        });
        finishedCount += 1;
        context.store.setProgress(
          `Scanning ${directories.length} projects… (${finishedCount}/${directories.length})`,
        );
        return { directory: projectScan.directory, result, config: projectScan.config };
      },
    );

    const projects = results.map(({ directory, result }) =>
      toScanReport({
        result,
        rootDirectory: directory,
        projectedScore: null,
        isOffline: context.isOffline,
        noScoreMessage: context.noScoreMessage,
      }),
    );
    const combinedDiagnostics = projects.flatMap((project) =>
      qualifyDiagnosticPaths(project.diagnostics, rootDirectory, project.rootDirectory),
    );
    const worst = findLowestScored(projects);
    const projectedScore = worst
      ? await computeProjectedScore(combinedDiagnostics, [...worst.diagnostics], worst.score)
      : null;
    const scannedFileCount = countUniqueScannedFiles(results.map(({ result }) => result));
    const elapsedMilliseconds = performance.now() - startTime;
    const lintFailureReason = resolveLintFailureReason(results.map(({ result }) => result));

    const summary: MultiProjectSummary = {
      projects,
      aggregateScore: worst?.score ?? null,
      projectedScore,
      combinedDiagnostics,
      scannedFileCount,
      elapsedMilliseconds,
      projectName: path.basename(rootDirectory),
      rootDirectory,
      isOffline: context.isOffline,
      noScoreMessage: context.noScoreMessage,
      ...(lintFailureReason ? { lintFailureReason } : {}),
    };
    context.store.setSummary(summary);
    return {
      scans: results,
      diagnostics: combinedDiagnostics,
      scoreResult: summary.aggregateScore,
      projectName: summary.projectName,
      scannedFileCount,
      elapsedMilliseconds,
    };
  });
};

export const runScanApp = async (input: RunScanAppInput): Promise<RunScanAppResult> => {
  const scanTarget = await resolveScanTarget(input.directory, { allowAmbiguous: true });
  const rootDirectory = scanTarget.resolvedDirectory;
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
  const blockingLevel = resolveBlockingLevel(
    { blocking: resolvedInput.blocking },
    scanTarget.userConfig,
  );

  if (selectedDirectories.length === 0) {
    return { shouldFail: false };
  }
  if (selectedDirectories.length === 1) {
    return runSingleProjectScan(scanTarget, selectedDirectories[0], resolvedInput, blockingLevel);
  }
  return runMultiProjectScan(scanTarget, selectedDirectories, resolvedInput, blockingLevel);
};
