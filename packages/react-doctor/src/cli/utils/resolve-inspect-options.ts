import type { ReactDoctorInspectOptions, ResolvedInspectOptions } from "../../inspect-options.js";
import { DEFAULT_SHOW_WARNINGS } from "../../core/core-configuration.js";
import type { ReactDoctorConfig } from "../../core/core-configuration.js";
import { resolveCliCategories } from "./resolve-cli-categories.js";

export interface InspectEnvironment {
  readonly isCiOrCodingAgentEnvironment: boolean;
  readonly isNonInteractiveEnvironment: boolean;
}

interface ResolveInspectOptionsInput {
  readonly inputOptions: ReactDoctorInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly environment: InspectEnvironment;
}

const buildIgnoredTags = (
  userConfig: ReactDoctorConfig | null,
  includedTags: ReadonlySet<string>,
): ReadonlySet<string> => {
  const ignoredTags = new Set<string>();
  if (userConfig?.ignore?.tags) {
    for (const tag of userConfig.ignore.tags) ignoredTags.add(tag);
  }
  for (const tag of includedTags) ignoredTags.delete(tag);
  return ignoredTags;
};

export const resolveInspectOptions = ({
  inputOptions,
  userConfig,
  environment,
}: ResolveInspectOptionsInput): ResolvedInspectOptions => {
  const includedTags = inputOptions.includedTags ?? new Set<string>();
  return {
    lint: inputOptions.lint ?? userConfig?.lint ?? true,
    deadCode: inputOptions.deadCode ?? userConfig?.deadCode ?? true,
    supplyChain: inputOptions.supplyChain ?? userConfig?.supplyChain?.enabled ?? true,
    verbose: inputOptions.verbose ?? userConfig?.verbose ?? false,
    outputDirectory: inputOptions.outputDirectory || null,
    scoreOnly: inputOptions.scoreOnly ?? false,
    noScore: inputOptions.noScore ?? userConfig?.noScore ?? false,
    isCi: inputOptions.isCi ?? false,
    isCiOrCodingAgentEnvironment: environment.isCiOrCodingAgentEnvironment,
    isNonInteractiveEnvironment: environment.isNonInteractiveEnvironment,
    silent: inputOptions.silent ?? false,
    includePaths: inputOptions.includePaths ?? [],
    customRulesOnly: includedTags.size > 0 ? false : (userConfig?.customRulesOnly ?? false),
    share: userConfig?.share ?? true,
    respectInlineDisables:
      inputOptions.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
    warnings: inputOptions.warnings ?? userConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    categoryFilters: new Set(resolveCliCategories(inputOptions.categoryFilters) ?? []),
    adoptExistingLintConfig:
      includedTags.size > 0 ? false : (userConfig?.adoptExistingLintConfig ?? true),
    ignoredTags: buildIgnoredTags(userConfig, includedTags),
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
  };
};
