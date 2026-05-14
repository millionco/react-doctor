import type { ProjectInfo } from "../../types/project-info.js";

const cachedProjectInfos = new Map<string, ProjectInfo>();

export const getCachedProject = (directory: string): ProjectInfo | undefined =>
  cachedProjectInfos.get(directory);

export const setCachedProject = (directory: string, projectInfo: ProjectInfo): void => {
  cachedProjectInfos.set(directory, projectInfo);
};

// HACK: paired with clearConfigCache — exposed so programmatic API
// consumers can re-detect after the project's package.json /
// tsconfig.json / monorepo manifests change between diagnose() calls.
export const clearProjectCache = (): void => {
  cachedProjectInfos.clear();
};
