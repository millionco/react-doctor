import type { ProjectInfo } from "../types/index.js";

/**
 * A project is worth scanning when it has React/Preact (the framework-
 * specific rules apply) OR it simply has source files to lint. The
 * second arm is what lets a plain TypeScript/JavaScript codebase — no
 * React dependency at all — run the framework-agnostic rules
 * (security, architecture, zod, bundle-size, …) instead of hard-failing
 * with "No React dependency". Only a directory with neither React nor a
 * single source file has nothing to analyze.
 */
export const isAnalyzableProject = (project: ProjectInfo): boolean =>
  project.reactVersion !== null || project.preactVersion !== null || project.sourceFileCount > 0;
