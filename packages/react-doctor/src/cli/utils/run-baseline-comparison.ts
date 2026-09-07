import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  computeDiagnosticDelta,
  classifyFileContext,
  filterPathsOutsideDirectories,
  filterSourceFiles,
  isPathInsideDirectory,
  JSX_DUPLICATION_SOURCE_FILE_PATTERN,
  listSourceFilesCooperative,
  remainingDeadlineBudgetMs,
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
import { copyUnchangedBaselineSources } from "./copy-unchanged-baseline-sources.js";
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

export interface BaselineDegradationReason {
  readonly code:
    | "deadline-budget-exhausted"
    | "deadline-listing-aborted"
    | "materialization-failed"
    | "snapshot-incomplete"
    | "dead-code-copy-failed"
    | "expected-head-files-missing"
    | "base-lint-failed";
  readonly detail?: string;
}

export type BaselineComparisonResult =
  | { success: true; comparison: BaselineComparison }
  | { success: false; reason: BaselineDegradationReason };

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
): Promise<BaselineComparisonResult> => {
  const verbose = input.options.verbose;
  const logDegradation = (reason: BaselineDegradationReason): void => {
    if (verbose) {
      const message = reason.detail
        ? `Baseline degraded: ${reason.code} (${reason.detail})`
        : `Baseline degraded: ${reason.code}`;
      console.error(message);
    }
  };

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
  const remainingBaselineBudgetMs =
    input.deadlineEpochMs === null ? null : remainingDeadlineBudgetMs(input.deadlineEpochMs);
  if (remainingBaselineBudgetMs === 0) {
    const reason = { code: "deadline-budget-exhausted" as const };
    logDegradation(reason);
    return { success: false, reason };
  }
  const baselineDeadlineSignal =
    remainingBaselineBudgetMs === null ? undefined : AbortSignal.timeout(remainingBaselineBudgetMs);
  const baselineListingSignal =
    baselineDeadlineSignal === undefined
      ? input.oxlintRuntime.abortSignal
      : input.oxlintRuntime.abortSignal === undefined
        ? baselineDeadlineSignal
        : AbortSignal.any([input.oxlintRuntime.abortSignal, baselineDeadlineSignal]);
  let maintainabilitySourceFiles: string[] = [];
  if (input.options.deadCode) {
    try {
      maintainabilitySourceFiles = (
        await listSourceFilesCooperative(input.directory, baselineListingSignal)
      ).filter(
        (filePath) =>
          JSX_DUPLICATION_SOURCE_FILE_PATTERN.test(filePath) &&
          classifyFileContext(filePath) === "production",
      );
    } catch (error) {
      if (baselineDeadlineSignal?.aborted) {
        const reason = { code: "deadline-listing-aborted" as const };
        logDegradation(reason);
        return { success: false, reason };
      }
      throw error;
    }
  }
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), BASELINE_FILES_TEMP_DIR_PREFIX));
  const snapshot = await materializeBaselineFiles({
    directory: input.directory,
    ref: input.baselineRef,
    files: input.options.deadCode ? input.options.includePaths : baselineIncludePaths,
    baseFiles: input.options.deadCode ? input.baseFiles : baselineBaseFiles,
    headFiles: input.options.deadCode ? input.headFiles : baselineHeadFiles,
    tempDirectory: temporaryDirectory,
  }).catch((error: unknown) => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  });
  if (snapshot === null) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    const reason = { code: "materialization-failed" as const };
    logDegradation(reason);
    return { success: false, reason };
  }

  try {
    if (!snapshot.isComplete) {
      const unmaterializedCount = snapshot.unmaterializedFiles.length;
      const materializedBaseFiles = new Set(snapshot.materializedFiles);
      const missingBaseFiles = snapshot.baseFiles.filter(
        (filePath) => !materializedBaseFiles.has(filePath),
      );
      const reason = {
        code: "snapshot-incomplete" as const,
        detail: `${missingBaseFiles.length} base file(s) could not be materialized: ${missingBaseFiles.slice(0, 3).join(", ")}${missingBaseFiles.length > 3 ? `, and ${missingBaseFiles.length - 3} more` : ""}`,
      };
      logDegradation(reason);
      return { success: false, reason };
    }
    if (
      input.options.deadCode &&
      !(await copyUnchangedBaselineSources({
        directory: input.directory,
        sourceFiles: maintainabilitySourceFiles,
        baseMaterializedFiles: snapshot.materializedFiles,
        headChangedFiles: snapshot.headFiles,
        untrackedFiles: snapshot.untrackedFiles,
        tempDirectory: snapshot.tempDirectory,
        deadlineEpochMs: input.deadlineEpochMs,
        signal: input.oxlintRuntime.abortSignal,
      }))
    ) {
      const reason = { code: "dead-code-copy-failed" as const };
      logDegradation(reason);
      return { success: false, reason };
    }
    const filteredSnapshotBaseFiles = filterPathsOutsideDirectories({
      rootDirectory: input.directory,
      relativePaths: snapshot.baseFiles,
      excludedDirectories: input.options.excludedProjectDirectories,
    });
    const filteredSnapshotHeadFiles = filterPathsOutsideDirectories({
      rootDirectory: input.directory,
      relativePaths: snapshot.headFiles,
      excludedDirectories: input.options.excludedProjectDirectories,
    });
    const analyzedHeadFiles = new Set(input.headAnalyzedFiles.map(toForwardSlashes));
    const baseFiles = new Set(
      (baselineBaseFiles ?? filteredSnapshotBaseFiles).map(toForwardSlashes),
    );
    const expectedHeadFiles = new Set(
      (baselineHeadFiles ?? filteredSnapshotHeadFiles).map(toForwardSlashes),
    );
    for (const filePath of baselineIncludePaths) {
      const normalizedFilePath = toForwardSlashes(filePath);
      if (!baseFiles.has(normalizedFilePath)) expectedHeadFiles.add(normalizedFilePath);
    }
    if (
      input.options.lint &&
      filterSourceFiles([...expectedHeadFiles]).some((filePath) => !analyzedHeadFiles.has(filePath))
    ) {
      const missingFiles = filterSourceFiles([...expectedHeadFiles]).filter(
        (filePath) => !analyzedHeadFiles.has(filePath),
      );
      const reason = {
        code: "expected-head-files-missing" as const,
        detail: `${missingFiles.length} expected head file(s) were not analyzed: ${missingFiles.slice(0, 3).join(", ")}${missingFiles.length > 3 ? `, and ${missingFiles.length - 3} more` : ""}`,
      };
      logDegradation(reason);
      return { success: false, reason };
    }

    const baselineLintPaths = new Set(
      [...baselineIncludePaths, ...filteredSnapshotBaseFiles].map(toForwardSlashes),
    );
    const materializedLintPaths = snapshot.materializedFiles.filter((filePath) =>
      baselineLintPaths.has(toForwardSlashes(filePath)),
    );
    const maintainabilityFocusPaths = [
      ...new Set([...input.options.includePaths, ...snapshot.baseFiles].map(toForwardSlashes)),
    ];
    const baselineExcludedProjectDirectories = input.options.excludedProjectDirectories
      .map((excludedDirectory) => path.resolve(excludedDirectory))
      .filter((excludedDirectory) => isPathInsideDirectory(excludedDirectory, input.directory))
      .map((excludedDirectory) =>
        path.resolve(snapshot.tempDirectory, path.relative(input.directory, excludedDirectory)),
      );
    const baseIncludePaths =
      materializedLintPaths.length > 0 ? materializedLintPaths : maintainabilityFocusPaths;
    const runtimeLayers = buildRuntimeLayers({
      directory: snapshot.tempDirectory,
      hasConfigOverride: true,
      userConfig: input.userConfig,
      configSourceDirectory: input.configSourceDirectory,
      projectInfoOverride: input.headProjectInfo,
      shouldSkipLint:
        !input.options.lint || !input.resolvedNodeBinaryPath || materializedLintPaths.length === 0,
      shouldRunDeadCode: input.options.deadCode,
      shouldRunSupplyChain: input.options.supplyChain,
      shouldComputeScore: false,
      shouldShowProgressSpinners: false,
      oxlintConcurrency: input.oxlintRuntime.concurrency,
      oxlintSpawnSlots: input.oxlintRuntime.spawnSlots,
    });
    const baseProgram = runInspectEffect(
      {
        directory: snapshot.tempDirectory,
        includePaths: baseIncludePaths,
        maintainabilityFocusPaths,
        customRulesOnly: input.options.customRulesOnly,
        respectInlineDisables: input.options.respectInlineDisables,
        warnings: input.options.warnings,
        adoptExistingLintConfig: input.options.adoptExistingLintConfig,
        ignoredTags: input.options.ignoredTags,
        includedTags: input.options.includedTags,
        includeTagDefaults: input.options.includeTagDefaults,
        nodeBinaryPath: input.resolvedNodeBinaryPath ?? undefined,
        runDeadCode: input.options.deadCode,
        isCi: input.options.isCi,
        doctorVersion: VERSION,
        runId: getRunId(),
        resolveLocalGithubViewerPermission: false,
        suppressScanSummary: true,
        supplyChainManifestChanged: input.options.supplyChainManifestChanged,
        deadlineEpochMs: input.deadlineEpochMs ?? undefined,
        signal: input.oxlintRuntime.abortSignal,
        excludedProjectDirectories: baselineExcludedProjectDirectories,
        retainExcludedProjectDeadCodeDiagnostics:
          input.options.retainExcludedProjectDeadCodeDiagnostics,
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
    if (
      baseOutput.didLintFail ||
      baseOutput.didDeadCodeFail ||
      countIncompleteLintFiles(baseOutput.lintPartialFailures) > 0
    ) {
      const reasons: string[] = [];
      if (baseOutput.didLintFail) reasons.push("lint failed");
      if (baseOutput.didDeadCodeFail) reasons.push("dead code analysis failed");
      const incompleteCount = countIncompleteLintFiles(baseOutput.lintPartialFailures);
      if (incompleteCount > 0) reasons.push(`${incompleteCount} file(s) had incomplete lint`);
      const reason = {
        code: "base-lint-failed" as const,
        detail: reasons.join(", "),
      };
      logDegradation(reason);
      return { success: false, reason };
    }

    const hasUnscannedUntrackedSourceFiles = filterSourceFiles(
      filterPathsOutsideDirectories({
        rootDirectory: input.directory,
        relativePaths: snapshot.untrackedFiles,
        excludedDirectories: input.options.excludedProjectDirectories,
      }).map(toForwardSlashes),
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
      success: true,
      comparison: {
        displayDiagnostics: diagnosticDelta.newDiagnostics,
        baselineDelta: {
          baseRef: input.baselineRef,
          fixedCount: hasUnscannedUntrackedSourceFiles ? 0 : diagnosticDelta.fixedCount,
          baseTotalCount: baseOutput.diagnostics.length,
          crossFileMatchCount: diagnosticDelta.crossFileMatchCount,
        },
      },
    };
  } finally {
    snapshot.cleanup();
  }
};
