import type { ProjectInfo } from "../types/index.js";

/**
 * Whether project discovery resolved a React-compatible runtime (React or
 * Preact, which ships the same hooks + JSX model). This is the same
 * predicate that grants the `react` capability, so `false` means every
 * React-runtime rule family was gated off for the project.
 */
export const hasReactRuntime = (project: ProjectInfo): boolean =>
  project.reactVersion !== null || project.preactVersion !== null;
