import * as path from "node:path";
import type { WorkspacePackage } from "@react-doctor/core";
import {
  discoverReactSubprojects,
  highlighter,
  isDirectory,
  isFile,
  isMonorepoRoot,
  listWorkspacePackages,
} from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { CliInputError } from "./cli-input-error.js";
import { METRIC } from "./constants.js";
import { prompts } from "./prompts.js";
import { recordCount } from "./record-metric.js";

export const selectProjects = async (
  rootDirectory: string,
  projectFlag: string | undefined,
  skipPrompts: boolean,
  configProjects?: readonly string[],
): Promise<string[]> => {
  const hasRootPackageJson = isFile(path.join(rootDirectory, "package.json"));
  let packages = listWorkspacePackages(rootDirectory);
  if (packages.length === 0 && (!hasRootPackageJson || isMonorepoRoot(rootDirectory))) {
    packages = discoverReactSubprojects(rootDirectory);
  }

  // The flag wins over workspace discovery: it can name packages OR point at
  // arbitrary directories (per-module scoring in repos whose modules aren't
  // workspace packages), so it must resolve even when discovery finds 0 or 1
  // packages — previously it was silently ignored in those cases.
  if (projectFlag) return resolveProjectFlag(projectFlag, packages, rootDirectory);

  // The config's `projects` field is the flag's persistent form: same
  // resolution, same errors, but declared once in doctor.config.* instead
  // of on every invocation. The flag (handled above) overrides it.
  const configRequestedNames = (configProjects ?? [])
    .map((requestedName) => requestedName.trim())
    .filter((requestedName) => requestedName.length > 0);
  if (configRequestedNames.length > 0) {
    const resolvedDirectories = resolveRequestedProjects(
      configRequestedNames,
      packages,
      rootDirectory,
      "config",
    );
    recordCount(METRIC.projectConfigSelected, resolvedDirectories.length);
    return resolvedDirectories;
  }

  if (packages.length === 0) return [rootDirectory];
  if (packages.length === 1) {
    logger.log(
      `${highlighter.success("✔")} Select projects ${highlighter.dim("›")} ${packages[0].name}`,
    );
    return [packages[0].directory];
  }

  if (skipPrompts) {
    printDiscoveredProjects(packages);
    return packages.map((workspacePackage) => workspacePackage.directory);
  }

  return promptProjectSelection(packages, rootDirectory);
};

const ALL_PROJECTS_SENTINEL = "*";

const resolveProjectFlag = (
  projectFlag: string,
  workspacePackages: WorkspacePackage[],
  rootDirectory: string,
): string[] => {
  const requestedNames = projectFlag
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  // A truthy flag that names nothing (e.g. `--project ","` or all-whitespace)
  // is invalid input — reject it instead of silently scanning zero projects.
  if (requestedNames.length === 0) {
    throw new CliInputError(
      `--project "${projectFlag}" did not name any project. Pass a project name, a comma-separated list, or "*" for all.`,
    );
  }

  return resolveRequestedProjects(requestedNames, workspacePackages, rootDirectory, "flag");
};

const resolveRequestedProjects = (
  requestedNames: string[],
  workspacePackages: WorkspacePackage[],
  rootDirectory: string,
  source: "flag" | "config",
): string[] => {
  // `*` (the GitHub Action's default) selects every discovered project,
  // making "scan all workspace projects" explicit instead of relying on
  // the empty-flag prompt-skip fallback.
  if (requestedNames.includes(ALL_PROJECTS_SENTINEL)) {
    return workspacePackages.length > 0
      ? workspacePackages.map((workspacePackage) => workspacePackage.directory)
      : [rootDirectory];
  }

  const sourceLabel = source === "flag" ? "Project" : 'Config "projects" entry';
  const resolvedDirectories: string[] = [];
  let pathSelectionCount = 0;

  for (const requestedName of requestedNames) {
    const matched = workspacePackages.find(
      (workspacePackage) =>
        workspacePackage.name === requestedName ||
        path.basename(workspacePackage.directory) === requestedName,
    );

    if (matched) {
      resolvedDirectories.push(matched.directory);
      continue;
    }

    const candidateDirectory = path.resolve(rootDirectory, requestedName);
    if (isDirectory(candidateDirectory)) {
      resolvedDirectories.push(candidateDirectory);
      pathSelectionCount += 1;
      continue;
    }

    const availableNames = workspacePackages
      .map((workspacePackage) => workspacePackage.name)
      .join(", ");
    throw new CliInputError(
      workspacePackages.length > 0
        ? `${sourceLabel} "${requestedName}" is not a workspace project or a directory. Available projects: ${availableNames}`
        : `${sourceLabel} "${requestedName}" is not a directory under ${rootDirectory}.`,
    );
  }

  if (pathSelectionCount > 0) {
    recordCount(METRIC.projectPathSelected, pathSelectionCount);
  }

  return resolvedDirectories;
};

const printDiscoveredProjects = (packages: WorkspacePackage[]): void => {
  logger.log(
    `${highlighter.success("✔")} Select projects ${highlighter.dim("›")} ${packages.map((workspacePackage) => workspacePackage.name).join(", ")}`,
  );
};

const promptProjectSelection = async (
  workspacePackages: WorkspacePackage[],
  rootDirectory: string,
): Promise<string[]> => {
  const { selectedDirectories } = await prompts({
    type: "multiselect",
    name: "selectedDirectories",
    message: "Select projects",
    choices: workspacePackages.map((workspacePackage) => ({
      title: workspacePackage.name,
      description: path.relative(rootDirectory, workspacePackage.directory),
      value: workspacePackage.directory,
    })),
    min: 1,
  });

  return selectedDirectories;
};
