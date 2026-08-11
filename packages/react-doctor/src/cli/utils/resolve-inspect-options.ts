import { DEFAULT_SHOW_WARNINGS, type ReactDoctorConfig } from "@react-doctor/core";
import type { ReactDoctorInspectOptions, ResolvedInspectOptions } from "../../inspect-options.js";
import { isCiOrCodingAgentEnvironment } from "./is-ci-environment.js";
import { isNonInteractiveEnvironment } from "./is-non-interactive-environment.js";
import { resolveCliCategories } from "./resolve-cli-categories.js";

const resolveIgnoredTags = (
  userConfig: ReactDoctorConfig | null,
  includedTags: ReadonlySet<string>,
): ReadonlySet<string> => {
  const ignoredTags = new Set(userConfig?.ignore?.tags ?? []);
  for (const includedTag of includedTags) ignoredTags.delete(includedTag);
  return ignoredTags;
};

export const resolveInspectOptions = (
  inputOptions: ReactDoctorInspectOptions,
  userConfig: ReactDoctorConfig | null,
): ResolvedInspectOptions => {
  const includedTags = inputOptions.includedTags ?? new Set<string>();
  const hasIncludedTags = includedTags.size > 0;
  return {
    lint: inputOptions.lint ?? userConfig?.lint ?? true,
    deadCode: inputOptions.deadCode ?? userConfig?.deadCode ?? true,
    supplyChain: inputOptions.supplyChain ?? userConfig?.supplyChain?.enabled ?? true,
    verbose: inputOptions.verbose ?? userConfig?.verbose ?? false,
    outputDirectory: inputOptions.outputDirectory || null,
    scoreOnly: inputOptions.scoreOnly ?? false,
    noScore: inputOptions.noScore ?? userConfig?.noScore ?? false,
    isCi: inputOptions.isCi ?? false,
    isCiOrCodingAgentEnvironment: isCiOrCodingAgentEnvironment(),
    isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
    silent: inputOptions.silent ?? false,
    includePaths: inputOptions.includePaths ?? [],
    customRulesOnly: hasIncludedTags ? false : (userConfig?.customRulesOnly ?? false),
    share: userConfig?.share ?? true,
    respectInlineDisables:
      inputOptions.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
    warnings: inputOptions.warnings ?? userConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    categoryFilters: new Set(resolveCliCategories(inputOptions.categoryFilters) ?? []),
    adoptExistingLintConfig: hasIncludedTags
      ? false
      : (userConfig?.adoptExistingLintConfig ?? true),
    ignoredTags: resolveIgnoredTags(userConfig, includedTags),
    includedTags,
    includeTagDefaults: inputOptions.includeTagDefaults ?? false,
    scoreDisabledMessage: inputOptions.scoreDisabledMessage,
    outputSurface: inputOptions.outputSurface ?? "cli",
    suppressRendering: (inputOptions.suppressRendering ?? false) || inputOptions.uiLayers != null,
    uiLayers: inputOptions.uiLayers ?? null,
    concurrentScan: inputOptions.concurrentScan ?? false,
    concurrency: inputOptions.concurrency,
    maxDurationMs: inputOptions.maxDurationMs ?? null,
    baseline: inputOptions.baseline ?? null,
    changedLineRanges: inputOptions.changedLineRanges ?? null,
    supplyChainManifestChanged: inputOptions.supplyChainManifestChanged ?? false,
    excludedProjectDirectories: inputOptions.excludedProjectDirectories ?? [],
    retainExcludedProjectDeadCodeDiagnostics:
      inputOptions.retainExcludedProjectDeadCodeDiagnostics ?? false,
    precomputedSourceFileCount: inputOptions.precomputedSourceFileCount,
  };
};
