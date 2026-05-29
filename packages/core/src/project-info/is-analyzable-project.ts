import type { ProjectInfo } from "../types/index.js";

export const isAnalyzableProject = (project: ProjectInfo): boolean =>
  project.reactVersion !== null || project.preactVersion !== null;
