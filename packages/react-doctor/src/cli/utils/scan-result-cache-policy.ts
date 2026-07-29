import type { ChangedFileLineRanges } from "../../core/core-types.js";
import type { ResolvedInspectOptions } from "../../inspect-options.js";

export interface ScanResultCachePolicy {
  readonly lint: boolean;
  readonly deadCode: boolean;
  readonly supplyChain: boolean;
  readonly includePaths: ReadonlyArray<string>;
  readonly customRulesOnly: boolean;
  readonly respectInlineDisables: boolean;
  readonly warnings: boolean;
  readonly adoptExistingLintConfig: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly includedTags: ReadonlySet<string>;
  readonly includeTagDefaults: boolean;
  readonly concurrency: number | undefined;
  readonly baselineRef: string | undefined;
  readonly changedLineRanges: ReadonlyArray<ChangedFileLineRanges> | null;
  readonly noScore: boolean;
  readonly isCi: boolean;
  readonly suppressRendering: boolean;
  readonly supplyChainManifestChanged: boolean;
}

export const buildScanResultCachePolicy = (
  options: ResolvedInspectOptions,
): ScanResultCachePolicy => ({
  lint: options.lint,
  deadCode: options.deadCode,
  supplyChain: options.supplyChain,
  includePaths: options.includePaths,
  customRulesOnly: options.customRulesOnly,
  respectInlineDisables: options.respectInlineDisables,
  warnings: options.warnings,
  adoptExistingLintConfig: options.adoptExistingLintConfig,
  ignoredTags: options.ignoredTags,
  includedTags: options.includedTags,
  includeTagDefaults: options.includeTagDefaults,
  concurrency: options.concurrency,
  baselineRef: options.baseline?.ref,
  changedLineRanges: options.changedLineRanges,
  noScore: options.noScore,
  isCi: options.isCi,
  suppressRendering: options.suppressRendering,
  supplyChainManifestChanged: options.supplyChainManifestChanged,
});
