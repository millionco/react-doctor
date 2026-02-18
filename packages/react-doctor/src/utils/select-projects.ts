import path from "node:path";
import type { WorkspacePackage } from "../types.js";
import { discoverReactSubprojects, listWorkspacePackages } from "./discover-project.js";
import { highlighter } from "./highlighter.js";
import { logger } from "./logger.js";
import { prompts } from "./prompts.js";

export const selectProjects = async (
  rootDirectory: string,
  projectFlag: string | undefined,
  skipPrompts: boolean,
  packageJsonDirectory?: string,
): Promise<string[]> => {
  let packages = listWorkspacePackages(rootDirectory, packageJsonDirectory);
  if (packages.length === 0) {
    packages = discoverReactSubprojects(rootDirectory, packageJsonDirectory);
  }

  if (packages.length === 0) return [rootDirectory];
  if (packages.length === 1) {
    logger.log(
      `${highlighter.success("✔")} Select projects to scan ${highlighter.dim("›")} ${packages[0].name}`,
    );
    return [packages[0].directory];
  }

  if (projectFlag) return resolveProjectFlag(projectFlag, packages);

  if (skipPrompts) {
    printDiscoveredProjects(packages);
    return packages.map((workspacePackage) => workspacePackage.directory);
  }

  return promptProjectSelection(packages, rootDirectory);
};

const resolveProjectFlag = (
  projectFlag: string,
  workspacePackages: WorkspacePackage[],
): string[] => {
  const requestedNames = projectFlag.split(",").map((name) => name.trim());
  const resolvedDirectories: string[] = [];

  for (const requestedName of requestedNames) {
    const matched = workspacePackages.find(
      (workspacePackage) =>
        workspacePackage.name === requestedName ||
        path.basename(workspacePackage.directory) === requestedName,
    );

    if (!matched) {
      const availableNames = workspacePackages
        .map((workspacePackage) => workspacePackage.name)
        .join(", ");
      throw new Error(`Project "${requestedName}" not found. Available: ${availableNames}`);
    }

    resolvedDirectories.push(matched.directory);
  }

  return resolvedDirectories;
};

const printDiscoveredProjects = (packages: WorkspacePackage[]): void => {
  logger.log(
    `${highlighter.success("✔")} Select projects to scan ${highlighter.dim("›")} ${packages.map((workspacePackage) => workspacePackage.name).join(", ")}`,
  );
};

const promptProjectSelection = async (
  workspacePackages: WorkspacePackage[],
  rootDirectory: string,
): Promise<string[]> => {
  const { selectedDirectories } = await prompts({
    type: "multiselect",
    name: "selectedDirectories",
    message: "Select projects to scan",
    choices: workspacePackages.map((workspacePackage) => ({
      title: workspacePackage.name,
      description: path.relative(rootDirectory, workspacePackage.directory),
      value: workspacePackage.directory,
    })),
    min: 1,
  });

  return selectedDirectories;
};
