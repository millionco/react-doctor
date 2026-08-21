import type { ProjectInfo } from "../types/index.js";
import { hasReactRuntime } from "../utils/has-react-runtime.js";

/**
 * A project is worth scanning when it has a supported runtime (the runtime-
 * specific rules apply) OR it simply has source files to lint. The
 * second arm is what lets a plain TypeScript/JavaScript codebase — no
 * React dependency at all — run the framework-agnostic rules
 * (security, architecture, zod, bundle-size, …) instead of hard-failing
 * with "No React dependency". Only a directory with neither a supported
 * runtime nor a single source file has nothing to analyze.
 */
export const isAnalyzableProject = (project: ProjectInfo): boolean =>
  hasReactRuntime(project) ||
  project.hasThree === true ||
  project.hasRemotion === true ||
  project.sourceFileCount > 0;
