import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  computeDiagnosticDelta,
  filterPathsOutsideDirectories,
  filterSourceFiles,
  type Diagnostic,
  type InspectResult,
  PerFileLintCacheEnabled,
  type ProjectInfo,
  type ReactDoctorConfig,
  restoreLegacyThrow,
  runInspect as runInspectEffect,
  SidecarLintCacheEnabled,
} from "@react-doctor/core";
import type { ResolvedInspectOptions } from "../../inspect-options.js";
import type { OxlintInvocationRuntime } from "../../inspect-runtime.js";
import { buildRuntimeLayers } from "./build-runtime-layers.js";
import { BASELINE_FILES_TEMP_DIR_PREFIX } from "./constants.js";
import { countDeadlineSkippedFiles } from "./count-deadline-skipped-files.js";
import { countDroppedLintFiles } from "./count-dropped-lint-files.js";
import { createDiagnosticEvidenceReader } from "./read-diagnostic-evidence.js";
import { createSourceLineReader } from "./read-source-line.js";
import { materializeBaselineFiles } from "./materialize-baseline-files.js";
import { makeNoopConsole } from "./noop-console.js";
import { toForwardSlashes } from "./path-format.js";
import { getRunId } from "./run-id.js";
import { VERSION } from "./version.js";

export interface BaselineComparison {
  readonly displayDiagnostics: ReadonlyArray<Diagnostic>;
  readonly baselineDelta: NonNullable<InspectResult["baselineDelta"]>;
}

export interface RunBaselineComparisonInput {
  readonly directory: string;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  readonly headProjectInfo: ProjectInfo;
  readonly headDiagnostics: ReadonlyArray<Diagnostic>;
  readonly resolvedNodeBinaryPath: string | null;
  readonly baselineRef: string;
  readonly baseFiles?: ReadonlyArray<string>;
  readonly headFiles?: ReadonlyArray<string>;
  readonly headAnalyzedFiles: ReadonlyArray<string>;
  readonly deadlineEpochMs: number | null;
  readonly oxlintRuntime: OxlintInvocationRuntime;
}

const silentConsole = makeNoopConsole();

export const countIncompleteLintFiles = (lintPartialFailures: ReadonlyArray<string>): number =>
  countDroppedLintFiles(lintPartialFailures) + countDeadlineSkippedFiles(lintPartialFailures);

export const runBaselineComparison = async (
  input: RunBaselineComparisonInput,
): Promise<BaselineComparison | null> => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), BASELINE_FILES_TEMP_DIR_PREFIX));
  const baselineIncludePaths = filterPathsOutsideDirectories({
    rootDirectory: input.directory,
    relativePaths: input.options.includePaths,
    excludedDirectories: input.options.excludedProjectDirectories,
  });
  const baselineBaseFiles = input.baseFiles
    ? filterPathsOutsideDirectories({
        rootDirectory: input.directory,
        relativePaths: input.baseFiles,
        excludedDirectories: input.options.excludedProjectDirectories,
      })
    : undefined;
  const baselineHeadFiles = input.headFiles
    ? filterPathsOutsideDirectories({
        rootDirectory: input.directory,
        relativePaths: input.headFiles,
        excludedDirectories: input.options.excludedProjectDirectories,
      })
    : undefined;
  const snapshot = await materializeBaselineFiles({
    directory: input.directory,
    ref: input.baselineRef,
    files: baselineIncludePaths,
    baseFiles: baselineBaseFiles,
    headFiles: baselineHeadFiles,
    tempDirectory: temporaryDirectory,
  }).catch((error: unknown) => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  });
  if (snapshot === null) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    return null;
  }

  try {
    if (!snapshot.isComplete) return null;
    const analyzedHeadFiles = new Set(input.headAnalyzedFiles.map(toForwardSlashes));
    const baseFiles = new Set(snapshot.baseFiles.map(toForwardSlashes));
    const expectedHeadFiles = new Set(snapshot.headFiles.map(toForwardSlashes));
    for (const filePath of baselineIncludePaths) {
      const normalizedFilePath = toForwardSlashes(filePath);
      if (!baseFiles.has(normalizedFilePath)) expectedHeadFiles.add(normalizedFilePath);
    }
    if (
      filterSourceFiles([...expectedHeadFiles]).some((filePath) => !analyzedHeadFiles.has(filePath))
    ) {
      return null;
    }

    const runtimeLayers = buildRuntimeLayers({
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
        signal: input.oxlintRuntime.abortSignal,
      },
      {},
    );
    const baseOutput = await Effect.runPromise(
      restoreLegacyThrow(
        baseProgram.pipe(
          Effect.provide(runtimeLayers),
          Effect.provideService(PerFileLintCacheEnabled, false),
          Effect.provideService(SidecarLintCacheEnabled, false),
          Effect.provideService(Console.Console, silentConsole),
        ),
      ),
      { signal: input.oxlintRuntime.abortSignal },
    );
    if (baseOutput.didLintFail || countIncompleteLintFiles(baseOutput.lintPartialFailures) > 0) {
      return null;
    }

    const hasUnscannedUntrackedSourceFiles = filterSourceFiles(
      snapshot.untrackedFiles.map(toForwardSlashes),
    ).some((filePath) => !analyzedHeadFiles.has(filePath));
    const diagnosticDelta = computeDiagnosticDelta({
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
      displayDiagnostics: diagnosticDelta.newDiagnostics,
      baselineDelta: {
        baseRef: input.baselineRef,
        fixedCount: hasUnscannedUntrackedSourceFiles ? 0 : diagnosticDelta.fixedCount,
        baseTotalCount: baseOutput.diagnostics.length,
        crossFileMatchCount: diagnosticDelta.crossFileMatchCount,
      },
    };
  } finally {
    snapshot.cleanup();
  }
};
