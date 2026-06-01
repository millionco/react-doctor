import * as Effect from "effect/Effect";
import { handleError } from "../utils/handle-error.js";
import { runInstallReactDoctor } from "../utils/install-react-doctor.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";
import { reportErrorToSentry } from "../utils/report-error.js";

interface InstallCommandOptions {
  yes?: boolean;
  dryRun?: boolean;
  agentHooks?: boolean;
  // Commander's `--cwd` always supplies `process.cwd()` as the default,
  // so this is defined when invoked via the CLI. The fallback is for
  // direct callers (tests) that construct the options object manually.
  cwd?: string;
}

interface InstallCommand {
  parent?: {
    opts?: () => {
      yes?: boolean;
    };
  };
}

export const installAction = async (
  options: InstallCommandOptions,
  command?: InstallCommand,
): Promise<void> => {
  Effect.runSync(printBrandedHeader);
  try {
    const parentOptions = command?.parent?.opts?.();
    await runInstallReactDoctor({
      yes: options.yes ?? parentOptions?.yes,
      dryRun: options.dryRun,
      agentHooks: options.agentHooks,
      projectRoot: options.cwd ?? process.cwd(),
    });
  } catch (error) {
    const sentryEventId = await reportErrorToSentry(error);
    handleError(error, { sentryEventId });
  }
};
