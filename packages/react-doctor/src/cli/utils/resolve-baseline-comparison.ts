import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type { ReactDoctorConfig } from "../../core/core-configuration.js";
import {
  PerFileLintCacheEnabled,
  runInspect as runInspectEffect,
  SidecarLintCacheEnabled,
} from "../../core/core-runtime.js";
import { computeDiagnosticDelta } from "../../core/core-diagnostic-semantics.js";
import { restoreLegacyThrow } from "../../core/core-errors.js";
import { filterSourceFiles } from "../../core/core-project-discovery.js";
import type { Diagnostic, InspectResult, ProjectInfo, WorkerSlots } from "../../core/core-types.js";
import type { ResolvedInspectOptions } from "../../contracts/inspect-options.js";
import { buildRuntimeLayers } from "./build-runtime-layers.js";
import { BASELINE_FILES_TEMP_DIR_PREFIX } from "./constants.js";
import { countDeadlineSkippedFiles } from "./count-deadline-skipped-files.js";
import { countDroppedLintFiles } from "./count-dropped-lint-files.js";
import { filterDiagnosticsByChangedLines } from "./filter-diagnostics-by-changed-lines.js";
import { materializeBaselineFiles } from "./materialize-baseline-files.js";
import { toForwardSlashes } from "./path-format.js";
import { createDiagnosticEvidenceReader } from "./read-diagnostic-evidence.js";
import { createSourceLineReader } from "./read-source-line.js";
import { getRunId } from "./run-id.js";
import { VERSION } from "./version.js";

interface BaselineComparison {
  readonly displayDiagnostics: ReadonlyArray<Diagnostic>;
  readonly baselineDelta: NonNullable<InspectResult["baselineDelta"]>;
}

export interface OxlintInvocationRuntime {
  readonly concurrency: number;
  readonly spawnSlots: WorkerSlots;
}

export interface ResolveBaselineComparisonInput {
  readonly directory: string;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  readonly headProjectInfo: ProjectInfo;
  readonly headDiagnostics: ReadonlyArray<Diagnostic>;
  readonly headAnalyzedFiles: ReadonlyArray<string>;
  readonly didLintFail: boolean;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly resolvedNodeBinaryPath: string | null;
  readonly deadlineEpochMs: number | null;
  readonly oxlintRuntime: OxlintInvocationRuntime;
  readonly silentConsole: Console.Console;
}

interface ResolvedBaselineComparison {
  readonly displayDiagnostics: ReadonlyArray<Diagnostic>;
  readonly baselineDelta: InspectResult["baselineDelta"];
}

const countIncompleteLintFiles = (lintPartialFailures: ReadonlyArray<string>): number =>
  countDroppedLintFiles(lintPartialFailures) + countDeadlineSkippedFiles(lintPartialFailures);

const runBaselineComparison = async (
  input: ResolveBaselineComparisonInput,
): Promise<BaselineComparison | null> => {
  const baseline = input.options.baseline;
  if (baseline === null) return null;

  const tempDirectory = mkdtempSync(path.join(tmpdir(), BASELINE_FILES_TEMP_DIR_PREFIX));
  const snapshot = await materializeBaselineFiles({
    directory: input.directory,
    ref: baseline.ref,
    files: input.options.includePaths,
    baseFiles: baseline.baseFiles,
    headFiles: baseline.headFiles,
    tempDirectory,
  }).catch((error: unknown) => {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  });
  if (snapshot === null) {
    rmSync(tempDirectory, { recursive: true, force: true });
    return null;
  }
  try {
    if (!snapshot.isComplete) return null;
    const analyzedHeadFiles = new Set(input.headAnalyzedFiles.map(toForwardSlashes));
    const baseFiles = new Set(snapshot.baseFiles.map(toForwardSlashes));
    const trackedHeadFiles = new Set(snapshot.headFiles.map(toForwardSlashes));
    const expectedHeadFiles = new Set(trackedHeadFiles);
    for (const filePath of input.options.includePaths) {
      const normalizedFilePath = toForwardSlashes(filePath);
      if (!baseFiles.has(normalizedFilePath)) expectedHeadFiles.add(normalizedFilePath);
    }
    if (
      filterSourceFiles([...expectedHeadFiles]).some((filePath) => !analyzedHeadFiles.has(filePath))
    ) {
      return null;
    }
    const baseLayers = buildRuntimeLayers({
      directory: snapshot.tempDirectory,
      hasConfigOverride: true,
      userConfig: input.userConfig,
      configSourceDirectory: input.configSourceDirectory,
      projectInfoOverride: input.headProjectInfo,
      shouldSkipLint: !input.options.lint || !input.resolvedNodeBinaryPath,
      shouldRunDeadCode: false,
      shouldRunSupplyChain: input.options.supplyChain,
      shouldComputeScore: false,
      shouldShowProgressSpinners: false,
      oxlintConcurrency: input.oxlintRuntime.concurrency,
      oxlintSpawnSlots: input.oxlintRuntime.spawnSlots,
    });
    const baseProgram = runInspectEffect(
      {
        directory: snapshot.tempDirectory,
        includePaths: snapshot.materializedFiles,
        customRulesOnly: input.options.customRulesOnly,
        respectInlineDisables: input.options.respectInlineDisables,
        warnings: input.options.warnings,
        adoptExistingLintConfig: input.options.adoptExistingLintConfig,
        ignoredTags: input.options.ignoredTags,
        includedTags: input.options.includedTags,
        includeTagDefaults: input.options.includeTagDefaults,
        nodeBinaryPath: input.resolvedNodeBinaryPath ?? undefined,
        runDeadCode: false,
        isCi: input.options.isCi,
        doctorVersion: VERSION,
        runId: getRunId(),
        resolveLocalGithubViewerPermission: false,
        suppressScanSummary: true,
        supplyChainManifestChanged: input.options.supplyChainManifestChanged,
        deadlineEpochMs: input.deadlineEpochMs ?? undefined,
      },
      {},
    );
    const baseOutput = await Effect.runPromise(
      restoreLegacyThrow(
        baseProgram.pipe(
          Effect.provide(baseLayers),
          Effect.provideService(PerFileLintCacheEnabled, false),
          Effect.provideService(SidecarLintCacheEnabled, false),
          Effect.provideService(Console.Console, input.silentConsole),
        ),
      ),
    );
    if (baseOutput.didLintFail || countIncompleteLintFiles(baseOutput.lintPartialFailures) > 0) {
      return null;
    }
    const hasUnscannedUntrackedSourceFiles = filterSourceFiles(
      snapshot.untrackedFiles.map(toForwardSlashes),
    ).some((filePath) => !analyzedHeadFiles.has(filePath));
    const delta = computeDiagnosticDelta({
      headDiagnostics: input.headDiagnostics,
      baseDiagnostics: baseOutput.diagnostics,
      readHeadLine: createSourceLineReader(input.directory),
      readBaseLine: createSourceLineReader(snapshot.tempDirectory),
      readHeadEvidence: createDiagnosticEvidenceReader(input.directory, {
        resolveForwardedHandlers: true,
      }),
      readBaseEvidence: createDiagnosticEvidenceReader(snapshot.tempDirectory),
    });
    return {
      displayDiagnostics: delta.newDiagnostics,
      baselineDelta: {
        baseRef: baseline.ref,
        fixedCount: hasUnscannedUntrackedSourceFiles ? 0 : delta.fixedCount,
        baseTotalCount: baseOutput.diagnostics.length,
        crossFileMatchCount: delta.crossFileMatchCount,
      },
    };
  } finally {
    snapshot.cleanup();
  }
};

export const resolveBaselineComparison = async (
  input: ResolveBaselineComparisonInput,
): Promise<ResolvedBaselineComparison> => {
  const isDiffMode = input.options.includePaths.length > 0;
  if (
    input.options.baseline !== null &&
    isDiffMode &&
    !input.didLintFail &&
    countIncompleteLintFiles(input.lintPartialFailures) === 0
  ) {
    const comparison = await runBaselineComparison(input);
    if (comparison !== null) return comparison;
  } else if (input.options.changedLineRanges !== null && isDiffMode) {
    return {
      displayDiagnostics: filterDiagnosticsByChangedLines({
        directory: input.directory,
        diagnostics: input.headDiagnostics,
        changedLineRanges: input.options.changedLineRanges,
      }),
      baselineDelta: undefined,
    };
  }

  return {
    displayDiagnostics: input.headDiagnostics,
    baselineDelta: undefined,
  };
};
