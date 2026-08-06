import { resolve } from "node:path";
import {
  DEFAULT_COGNITIVE_THRESHOLD,
  DEFAULT_CYCLOMATIC_THRESHOLD,
  DEFAULT_DUPLICATE_BLOCK_MIN_LINES,
  DEFAULT_DUPLICATE_BLOCK_MIN_OCCURRENCES,
  DEFAULT_DUPLICATE_BLOCK_MIN_TOKENS,
  DEFAULT_ENTRY_GLOBS,
  DEFAULT_EXTENSIONS,
  DEFAULT_FUNCTION_LINE_THRESHOLD,
  DEFAULT_PARAM_COUNT_THRESHOLD,
  DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
} from "./constants.js";
import type { DeslopConfig } from "./types.js";

const fillSemanticConfig = (
  semanticOverrides: Partial<DeslopConfig["semantic"]> | undefined,
): DeslopConfig["semantic"] => {
  const overrides = semanticOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    reportUnusedTypes: overrides.reportUnusedTypes ?? true,
    reportUnusedEnumMembers: overrides.reportUnusedEnumMembers ?? true,
    reportUnusedClassMembers: overrides.reportUnusedClassMembers ?? false,
    reportRedundantVariableAliases: overrides.reportRedundantVariableAliases ?? true,
    reportMisclassifiedDependencies: overrides.reportMisclassifiedDependencies ?? true,
    reportRoundTripAliases: overrides.reportRoundTripAliases ?? true,
    decoratorAllowlist: overrides.decoratorAllowlist ?? DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
  };
};

const fillDuplicateBlocksConfig = (
  duplicateBlocksOverrides: Partial<DeslopConfig["duplicateBlocks"]> | undefined,
): DeslopConfig["duplicateBlocks"] => {
  const overrides = duplicateBlocksOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    mode: overrides.mode ?? "semantic",
    minTokens: overrides.minTokens ?? DEFAULT_DUPLICATE_BLOCK_MIN_TOKENS,
    minLines: overrides.minLines ?? DEFAULT_DUPLICATE_BLOCK_MIN_LINES,
    minOccurrences: overrides.minOccurrences ?? DEFAULT_DUPLICATE_BLOCK_MIN_OCCURRENCES,
    skipLocal: overrides.skipLocal ?? false,
  };
};

const fillFeatureFlagsConfig = (
  featureFlagOverrides: Partial<DeslopConfig["featureFlags"]> | undefined,
): DeslopConfig["featureFlags"] => {
  const overrides = featureFlagOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    extraEnvPrefixes: overrides.extraEnvPrefixes ?? [],
    extraSdkFunctionNames: overrides.extraSdkFunctionNames ?? [],
    detectConfigObjects: overrides.detectConfigObjects ?? false,
  };
};

const fillComplexityConfig = (
  complexityOverrides: Partial<DeslopConfig["complexity"]> | undefined,
): DeslopConfig["complexity"] => {
  const overrides = complexityOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    cyclomaticThreshold: overrides.cyclomaticThreshold ?? DEFAULT_CYCLOMATIC_THRESHOLD,
    cognitiveThreshold: overrides.cognitiveThreshold ?? DEFAULT_COGNITIVE_THRESHOLD,
    paramCountThreshold: overrides.paramCountThreshold ?? DEFAULT_PARAM_COUNT_THRESHOLD,
    functionLineThreshold: overrides.functionLineThreshold ?? DEFAULT_FUNCTION_LINE_THRESHOLD,
  };
};

export const defineConfig = (
  options: Partial<DeslopConfig> & { rootDir: string },
): DeslopConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath,
  paths: options.paths,
  incrementalCachePath: options.incrementalCachePath,
  reportTypes: options.reportTypes ?? false,
  includeEntryExports: options.includeEntryExports ?? false,
  reportRedundancy: options.reportRedundancy ?? true,
  reportCodeQuality: options.reportCodeQuality ?? true,
  semantic: fillSemanticConfig(options.semantic),
  duplicateBlocks: fillDuplicateBlocksConfig(options.duplicateBlocks),
  featureFlags: fillFeatureFlagsConfig(options.featureFlags),
  complexity: fillComplexityConfig(options.complexity),
});
