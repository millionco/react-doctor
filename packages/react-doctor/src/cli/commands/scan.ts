import { inspectAction } from "./inspect.js";
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
  const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
  const canUseTui = shouldUseTui({
    flags: input.flags,
    isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
    nodeMajorVersion,
    stdinIsTty: process.stdin.isTTY === true,
    stdoutIsTty: process.stdout.isTTY === true,
    supportsRawMode: typeof process.stdin.setRawMode === "function",
    terminalName: process.env.TERM,
  });

  if (!canUseTui) {
    await inspectAction(input.directory, input.flags, input.invocationCommand);
    return;
  }

  recordCount(METRIC.cliInvoked, 1, { command: input.invocationCommand });
  const { runScanApp } = await import("../ink/run-scan-app.js");
  const { shouldFail } = await runScanApp({
    directory: input.directory,
    options: resolveCliInspectOptions(input.flags, null),
    projectFlag: input.flags.project,
    skipPrompts: input.flags.yes ?? false,
    blocking: input.flags.blocking,
  });
  if (shouldFail) process.exitCode = 1;
};
