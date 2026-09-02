import path from "node:path";
import { resolveScanTarget } from "@react-doctor/core";
import { inspectAction } from "./inspect.js";
import { runProjectMigrations } from "../utils/cli-migrations.js";
import { METRIC } from "../utils/constants.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { toForwardSlashes } from "../utils/path-format.js";
import { recordCount } from "../utils/record-metric.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveTuiEnvironment } from "../utils/resolve-tui-environment.js";
import { warnDeprecatedDiff } from "../utils/resolve-scope.js";
import { shouldUseTui } from "../utils/should-use-tui.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { warnDeprecatedFailOn } from "../utils/warn-deprecated-fail-on.js";

export interface RunScanCommandInput {
  readonly paths: string[];
  readonly flags: InspectFlags;
  readonly invocationCommand: string;
}

const normalizeFilePaths = (paths: string[], scanDirectory: string): string[] => {
  const resolvedScanDirectory = path.resolve(scanDirectory);
  return paths.map((filePath) => {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(resolvedScanDirectory, absolutePath);
    return toForwardSlashes(relativePath);
  });
};

export const runScanCommand = async (input: RunScanCommandInput): Promise<void> => {
  if (input.flags.cache === false) process.env.REACT_DOCTOR_NO_CACHE = "1";

  const directory = input.paths.length === 1 ? input.paths[0] : ".";
  const filePaths = input.paths.length > 1 ? normalizeFilePaths(input.paths, directory) : null;

  const tuiEnvironment = {
    flags: input.flags,
    ...resolveTuiEnvironment(),
  };

  if (!shouldUseTui(tuiEnvironment)) {
    await inspectAction(directory, input.flags, input.invocationCommand, filePaths);
    return;
  }

  await runProjectMigrations(path.resolve(directory));
  const scanTarget = await resolveScanTarget(directory, { allowAmbiguous: true });
  validateModeFlags(input.flags);
  warnDeprecatedFailOn(input.flags, scanTarget.userConfig);
  warnDeprecatedDiff(input.flags, scanTarget.userConfig);
  recordCount(METRIC.cliInvoked, 1, { command: input.invocationCommand });
  const { runScanApp } = await import("../ink/run-scan-app.js");
  const { shouldFail } = await runScanApp({
    directory,
    scanTarget,
    options: resolveCliInspectOptions(input.flags, null),
    projectFlag: input.flags.project,
    skipPrompts: input.flags.yes ?? false,
    blocking: input.flags.blocking ?? input.flags.failOn,
    flags: input.flags,
  });
  if (shouldFail) process.exitCode = 1;
};
