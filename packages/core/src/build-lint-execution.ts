import type { ProjectInfo } from "./types/index.js";
import type { ResolvedConfig } from "./services/config.js";
import type { LintFileCoverage, LintInput } from "./services/linter.js";

interface LintExecutionOptions {
  readonly nodeBinaryPath?: string;
  readonly customRulesOnly: boolean;
  readonly respectInlineDisables: boolean;
  readonly adoptExistingLintConfig: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly includedTags?: ReadonlySet<string>;
  readonly includeTagDefaults?: boolean;
  readonly deadlineEpochMs?: number;
}

interface BuildLintExecutionInput {
  readonly rootDirectory: string;
  readonly project: ProjectInfo;
  readonly includePaths: ReadonlyArray<string> | null | undefined;
  readonly options: LintExecutionOptions;
  readonly resolvedConfig: ResolvedConfig;
  readonly reportFileProgress: (scannedFileCount: number, totalFileCount: number) => void;
}

interface LintExecutionState {
  lastReportedTotalFileCount: number;
  fileCoverage: LintFileCoverage | null;
  cacheHitFileCount: number | null;
  cacheTotalFileCount: number | null;
  sidecarReplayedFileCount: number | null;
  sidecarTotalFileCount: number | null;
}

interface LintExecution {
  readonly input: LintInput;
  readonly state: LintExecutionState;
}

export const buildLintExecution = (input: BuildLintExecutionInput): LintExecution => {
  const state: LintExecutionState = {
    lastReportedTotalFileCount: 0,
    fileCoverage: null,
    cacheHitFileCount: null,
    cacheTotalFileCount: null,
    sidecarReplayedFileCount: null,
    sidecarTotalFileCount: null,
  };

  return {
    input: {
      rootDirectory: input.rootDirectory,
      project: input.project,
      includePaths: input.includePaths ?? undefined,
      nodeBinaryPath: input.options.nodeBinaryPath,
      customRulesOnly: input.options.customRulesOnly,
      respectInlineDisables: input.options.respectInlineDisables,
      adoptExistingLintConfig: input.options.adoptExistingLintConfig,
      ignoredTags: input.options.ignoredTags,
      includedTags: input.options.includedTags,
      includeTagDefaults: input.options.includeTagDefaults,
      userConfig: input.resolvedConfig.config ?? undefined,
      configSourceDirectory: input.resolvedConfig.configSourceDirectory ?? undefined,
      onFileProgress: (scannedFileCount, totalFileCount) => {
        state.lastReportedTotalFileCount = totalFileCount;
        input.reportFileProgress(scannedFileCount, totalFileCount);
      },
      onFileCoverage: (coverage) => {
        state.fileCoverage = coverage;
      },
      onCacheStats: (cacheHitFileCount, totalConsideredFileCount) => {
        state.cacheHitFileCount = cacheHitFileCount;
        state.cacheTotalFileCount = totalConsideredFileCount;
      },
      onSidecarStats: (sidecarReplayedFileCount, sidecarConsideredFileCount) => {
        state.sidecarReplayedFileCount = sidecarReplayedFileCount;
        state.sidecarTotalFileCount = sidecarConsideredFileCount;
      },
      deadlineEpochMs: input.options.deadlineEpochMs,
    },
    state,
  };
};
