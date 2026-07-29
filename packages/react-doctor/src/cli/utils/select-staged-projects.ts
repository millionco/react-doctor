import { cliLogger as logger } from "./cli-logger.js";
import { CliInputError } from "./cli-input-error.js";
import { selectProjects } from "./select-projects.js";

export const STAGED_PROJECT_FALLBACK_HINT =
  "Scanning the staged files at the scan root instead — fix the `projects` entries in your config to scan per package.";

export const selectStagedProjects = async (input: {
  readonly rootDirectory: string;
  readonly projectFlag: string | undefined;
  readonly configProjects: readonly string[] | undefined;
}): Promise<string[]> => {
  if (input.projectFlag) {
    return selectProjects(input.rootDirectory, input.projectFlag, true, undefined);
  }
  if (input.configProjects === undefined) return [input.rootDirectory];
  try {
    return await selectProjects(input.rootDirectory, undefined, true, input.configProjects);
  } catch (error) {
    if (!(error instanceof CliInputError)) throw error;
    logger.warn(`${error.message} ${STAGED_PROJECT_FALLBACK_HINT}`);
    logger.break();
    return [input.rootDirectory];
  }
};
