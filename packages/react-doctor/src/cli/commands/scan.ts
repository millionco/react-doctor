import path from "node:path";
import { resolveScanTarget } from "@react-doctor/core";
import { inspectAction } from "./inspect.js";
import { runProjectMigrations } from "../utils/cli-migrations.js";
import { METRIC } from "../utils/constants.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { isNonInteractiveEnvironment } from "../utils/is-non-interactive-environment.js";
import { recordCount } from "../utils/record-metric.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { shouldUseTui } from "../utils/should-use-tui.js";

export interface RunScanCommandInput {
  readonly directory: string;
  readonly flags: InspectFlags;
  readonly invocationCommand: string;
}

export const runScanCommand = async (input: RunScanCommandInput): Promise<void> => {
  if (input.flags.cache === false) process.env.REACT_DOCTOR_NO_CACHE = "1";
  const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
  const tuiEnvironment = {
    flags: input.flags,
    isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
    nodeMajorVersion,
    stdinIsTty: process.stdin.isTTY === true,
    stdoutIsTty: process.stdout.isTTY === true,
    supportsRawMode: typeof process.stdin.setRawMode === "function",
    terminalName: process.env.TERM,
  };

  if (!shouldUseTui(tuiEnvironment)) {
    await inspectAction(input.directory, input.flags, input.invocationCommand);
    return;
  }

  await runProjectMigrations(path.resolve(input.directory));
  const scanTarget = await resolveScanTarget(input.directory, { allowAmbiguous: true });
  if (!shouldUseTui({ ...tuiEnvironment, userConfig: scanTarget.userConfig })) {
    await inspectAction(input.directory, input.flags, input.invocationCommand);
    return;
  }
  recordCount(METRIC.cliInvoked, 1, { command: input.invocationCommand });
  const { runScanApp } = await import("../ink/run-scan-app.js");
  const { shouldFail } = await runScanApp({
    directory: input.directory,
    scanTarget,
    options: resolveCliInspectOptions(input.flags, null),
    projectFlag: input.flags.project,
    skipPrompts: input.flags.yes ?? false,
    blocking: input.flags.blocking,
  });
  if (shouldFail) process.exitCode = 1;
};
