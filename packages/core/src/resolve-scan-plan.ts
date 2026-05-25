import { resolveConfigRootDir } from "./resolve-config-root-dir.js";
import { loadConfigWithSource } from "./load-config.js";
import { resolveDiagnoseTarget } from "./resolve-diagnose-target.js";
import type { DiagnosticSurface, InspectOptions, ReactDoctorConfig } from "./types/index.js";

export interface ResolvedScanOptions {
  readonly lint: boolean;
  readonly deadCode: boolean;
  readonly verbose: boolean;
  readonly scoreOnly: boolean;
  readonly noScore: boolean;
  readonly isCi: boolean;
  readonly silent: boolean;
  readonly includePaths: string[];
  readonly customRulesOnly: boolean;
  readonly share: boolean;
  readonly respectInlineDisables: boolean;
  readonly adoptExistingLintConfig: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly outputSurface: DiagnosticSurface;
}

export interface ResolveScanPlanInput {
  readonly directory: string;
  readonly options?: InspectOptions;
  /**
   * `diagnose()` accepts a directory above the actual React project and
   * resolves it to the only React subproject when unambiguous. The CLI and
   * public `inspect()` do their own project selection, so they keep the
   * post-rootDir directory as-is.
   */
  readonly shouldResolveDiagnoseTarget?: boolean;
}

export interface ResolvedScanPlan {
  readonly requestedDirectory: string;
  readonly directoryAfterRootDir: string;
  readonly resolvedDirectory: string | null;
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  readonly hasConfigOverride: boolean;
  readonly options: ResolvedScanOptions;
}

const buildIgnoredTags = (userConfig: ReactDoctorConfig | null): ReadonlySet<string> => {
  const tags = new Set<string>();
  if (userConfig?.ignore?.tags) {
    for (const tag of userConfig.ignore.tags) tags.add(tag);
  }
  return tags;
};

const resolveUserConfig = (
  directory: string,
  options: InspectOptions,
): {
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  readonly directoryAfterRootDir: string;
  readonly hasConfigOverride: boolean;
} => {
  const hasConfigOverride = options.configOverride !== undefined;
  if (hasConfigOverride) {
    return {
      userConfig: options.configOverride ?? null,
      configSourceDirectory: null,
      directoryAfterRootDir: directory,
      hasConfigOverride,
    };
  }

  const loadedConfig = loadConfigWithSource(directory);
  const redirectedDirectory = resolveConfigRootDir(
    loadedConfig?.config ?? null,
    loadedConfig?.sourceDirectory ?? null,
  );
  return {
    userConfig: loadedConfig?.config ?? null,
    configSourceDirectory: loadedConfig?.sourceDirectory ?? null,
    directoryAfterRootDir: redirectedDirectory ?? directory,
    hasConfigOverride,
  };
};

export const resolveScanOptions = (
  options: InspectOptions,
  userConfig: ReactDoctorConfig | null,
): ResolvedScanOptions => ({
  lint: options.lint ?? userConfig?.lint ?? true,
  deadCode: options.deadCode ?? userConfig?.deadCode ?? true,
  verbose: options.verbose ?? userConfig?.verbose ?? false,
  scoreOnly: options.scoreOnly ?? false,
  noScore: options.noScore ?? userConfig?.noScore ?? false,
  isCi: options.isCi ?? false,
  silent: options.silent ?? false,
  includePaths: options.includePaths ?? [],
  customRulesOnly: userConfig?.customRulesOnly ?? false,
  share: userConfig?.share ?? true,
  respectInlineDisables: options.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
  adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
  ignoredTags: buildIgnoredTags(userConfig),
  outputSurface: options.outputSurface ?? "cli",
});

export const resolveScanPlan = (input: ResolveScanPlanInput): ResolvedScanPlan => {
  const options = input.options ?? {};
  const requestedDirectory = input.directory;
  const resolvedConfig = resolveUserConfig(requestedDirectory, options);
  const resolvedDirectory = input.shouldResolveDiagnoseTarget
    ? resolveDiagnoseTarget(resolvedConfig.directoryAfterRootDir)
    : resolvedConfig.directoryAfterRootDir;

  return {
    requestedDirectory,
    directoryAfterRootDir: resolvedConfig.directoryAfterRootDir,
    resolvedDirectory,
    userConfig: resolvedConfig.userConfig,
    configSourceDirectory: resolvedConfig.configSourceDirectory,
    hasConfigOverride: resolvedConfig.hasConfigOverride,
    options: resolveScanOptions(options, resolvedConfig.userConfig),
  };
};
