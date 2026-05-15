import { handleError } from "../utils/handle-error.js";
import { runInstallSkill } from "../utils/install-skill.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";

interface InstallCommandOptions {
  yes?: boolean;
  dryRun?: boolean;
  // Commander's `--cwd` always supplies `process.cwd()` as the default,
  // so this is defined when invoked via the CLI. The fallback is for
  // direct callers (tests) that construct the options object manually.
  cwd?: string;
}

export const installAction = async (options: InstallCommandOptions): Promise<void> => {
  printBrandedHeader();
  try {
    await runInstallSkill({
      yes: options.yes,
      dryRun: options.dryRun,
      projectRoot: options.cwd ?? process.cwd(),
    });
  } catch (error) {
    handleError(error);
  }
};
