import path from "node:path";
import { resolveScanTarget } from "@react-doctor/core";
import { inspectAction } from "./inspect.js";
import { runProjectMigrations } from "../utils/cli-migrations.js";
import { METRIC } from "../utils/constants.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { recordCount } from "../utils/record-metric.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveTuiEnvironment } from "../utils/resolve-tui-environment.js";
import { warnDeprecatedDiff } from "../utils/resolve-scope.js";
import { shouldUseTui } from "../utils/should-use-tui.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { warnDeprecatedFailOn } from "../utils/warn-deprecated-fail-on.js";

export interface RunScanCommandInput {
  readonly directory: string;
  readonly flags: InspectFlags;
  readonly invocationCommand: string;
}

export const runScanCommand = async (input: RunScanCommandInput): Promise<void> => {
  if (input.flags.cache === false) process.env.REACT_DOCTOR_NO_CACHE = "1";
  const tuiEnvironment = {
    flags: input.flags,
    ...resolveTuiEnvironment(),
  };

  if (!shouldUseTui(tuiEnvironment)) {
    await inspectAction(input.directory, input.flags, input.invocationCommand);
    return;
  }

  await runProjectMigrations(path.resolve(input.directory));
  const scanTarget = await resolveScanTarget(input.directory, { allowAmbiguous: true });
  validateModeFlags(input.flags);
  warnDeprecatedFailOn(input.flags, scanTarget.userConfig);
  warnDeprecatedDiff(input.flags, scanTarget.userConfig);
  recordCount(METRIC.cliInvoked, 1, { command: input.invocationCommand });
  const { runScanApp } = await import("../ink/run-scan-app.js");
  const { shouldFail } = await runScanApp({
    directory: input.directory,
    scanTarget,
    options: resolveCliInspectOptions(input.flags, null),
    projectFlag: input.flags.project,
    skipPrompts: input.flags.yes ?? false,
    blocking: input.flags.blocking ?? input.flags.failOn,
    flags: input.flags,
  });
  if (shouldFail) process.exitCode = 1;
};
