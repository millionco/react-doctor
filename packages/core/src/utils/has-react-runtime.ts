import type { ProjectInfo } from "../types/index.js";

const REACT_COMPATIBLE_FRAMEWORKS: ReadonlySet<ProjectInfo["framework"]> = new Set([
  "nextjs",
  "tanstack-start",
  "cra",
  "remix",
  "gatsby",
  "expo",
  "react-native",
  "preact",
]);

/**
 * Whether project discovery resolved a React-compatible runtime directly or
 * through a framework whose runtime is necessarily React-compatible.
 */
export const hasReactRuntime = (project: ProjectInfo): boolean =>
  project.reactVersion !== null ||
  project.preactVersion !== null ||
  REACT_COMPATIBLE_FRAMEWORKS.has(project.framework);
