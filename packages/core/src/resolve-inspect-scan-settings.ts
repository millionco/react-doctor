import { DEFAULT_SHOW_WARNINGS } from "./constants.js";
import { computeExplicitLintIncludePaths } from "./explicit-lint-include-paths.js";
import { resolveLintIncludePaths } from "./resolve-lint-include-paths.js";
import type { InspectInput } from "./run-inspect-contracts.js";
import type { ReactDoctorConfig } from "./types/index.js";

interface InspectScanSettings {
  readonly lintIncludePaths: ReadonlyArray<string> | undefined;
  readonly isDiffMode: boolean;
  readonly showWarnings: boolean;
  readonly shouldCollectFallbackScannedFilePaths: boolean;
  readonly shouldRunSupplyChain: boolean;
}

interface ResolveInspectScanSettingsInput {
  readonly input: InspectInput;
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
}

export const resolveInspectScanSettings = (
  settingsInput: ResolveInspectScanSettingsInput,
): InspectScanSettings => {
  const { input, rootDirectory, userConfig } = settingsInput;
  let explicitLintIncludePaths: ReadonlyArray<string> | undefined;
  if (input.skipExplicitIncludePathFilter) {
    explicitLintIncludePaths = input.includePaths.length > 0 ? [...input.includePaths] : undefined;
  } else {
    explicitLintIncludePaths = computeExplicitLintIncludePaths([...input.includePaths]);
  }
  const lintIncludePaths =
    explicitLintIncludePaths ?? resolveLintIncludePaths(rootDirectory, userConfig);
  const isDiffMode = input.includePaths.length > 0;

  return {
    lintIncludePaths,
    isDiffMode,
    showWarnings: input.warnings ?? userConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    shouldCollectFallbackScannedFilePaths: Boolean(input.suppressScanSummary),
    shouldRunSupplyChain: !isDiffMode || (input.supplyChainManifestChanged ?? false),
  };
};
