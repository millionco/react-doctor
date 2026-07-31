import { cliLogger as logger } from "./cli-logger.js";
import { CliInputError } from "./cli-input-error.js";
import { selectProjects } from "./select-projects.js";

/**
 * Appended to the reason a `--staged` run could not scan per package. Shared so
 * both fallback sites word it identically.
 */
export const STAGED_PROJECT_FALLBACK_HINT =
  "Scanning the staged files at the scan root instead — fix the `projects` entries in your config to scan per package.";

/**
 * Resolve the project directories a `--staged` scan owns. The interactive picker
 * is always skipped: a commit hook has nobody to answer it.
 */
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
    // Only a `CliInputError` — the "entry does not resolve" case. Everything
    // else propagates: an environment failure (permission denied, a path
    // blocked by a file) would otherwise degrade to a root-only scan and
    // report the vacuous clean scan this whole change exists to prevent.
    if (!(error instanceof CliInputError)) throw error;
    logger.warn(`${error.message} ${STAGED_PROJECT_FALLBACK_HINT}`);
    logger.break();
    return [input.rootDirectory];
  }
};
