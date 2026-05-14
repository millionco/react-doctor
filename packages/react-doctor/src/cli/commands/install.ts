import { handleError } from "../handle-error.js";
import { runInstallSkill } from "../install-skill.js";

interface InstallCommandOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export const installAction = async (options: InstallCommandOptions): Promise<void> => {
  try {
    await runInstallSkill({ yes: options.yes, dryRun: options.dryRun });
  } catch (error) {
    handleError(error);
  }
};
