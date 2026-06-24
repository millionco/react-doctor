import * as Effect from "effect/Effect";
import { METRIC } from "../utils/constants.js";
import {
  runCiConfig,
  runCiInstall,
  runCiUpgrade,
  type CiCommandOptions,
} from "../utils/ci/manage-ci.js";
import { handleError, handleUserError } from "../utils/handle-error.js";
import { isExpectedUserError } from "../utils/is-expected-user-error.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";
import { recordCount } from "../utils/record-metric.js";
import { reportErrorToSentry } from "../utils/report-error.js";

// Shared shell for the three `ci` subcommands: it stamps the invocation metric,
// prints the branded header, and funnels failures through the same crash
// reporting the other commands use, so each subcommand body stays focused on
// its own work.
const runCiCommand = async (
  subcommand: string,
  run: (options: CiCommandOptions) => Promise<void>,
  options: CiCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: `ci ${subcommand}` });
  Effect.runSync(printBrandedHeader);
  try {
    await run({ ...options, cwd: options.cwd ?? process.cwd() });
  } catch (error) {
    if (isExpectedUserError(error)) {
      handleUserError(error);
      return;
    }
    const sentryEventId = await reportErrorToSentry(error);
    handleError(error, { sentryEventId });
  }
};

export const ciInstallAction = (options: CiCommandOptions): Promise<void> =>
  runCiCommand("install", runCiInstall, options);

export const ciUpgradeAction = (options: CiCommandOptions): Promise<void> =>
  runCiCommand("upgrade", runCiUpgrade, options);

export const ciConfigAction = (options: CiCommandOptions): Promise<void> =>
  runCiCommand("config", runCiConfig, options);
