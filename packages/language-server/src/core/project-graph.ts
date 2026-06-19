import path from "node:path";
import {
  clearAutoSuppressionCaches,
  clearConfigCache,
  clearIgnorePatternsCache,
  clearMinifiedFileCache,
  clearPackageJsonCache,
  clearProjectCache,
  discoverReactSubprojects,
  messageFromUnknown,
} from "@react-doctor/core";
import { SILENT_LOGGER, type Logger, type ProjectGraph, type WorkspaceProject } from "../types.js";

export interface ProjectGraphOptions {
  /** Absolute workspace root directories (LSP workspace folders). */
  readonly roots: ReadonlyArray<string>;
  readonly logger?: Logger;
}

/** Normalizes a path to absolute, forward-slash, no trailing slash. */
const normalizeDirectory = (directory: string): string => {
  const resolved = path.resolve(directory).replace(/\\/g, "/");
  return resolved.length > 1 && resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
};

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(`${directory}/`);

/**
 * Discovers and indexes every React project across the workspace roots,
 * and answers "which project owns this file?" with the deepest match.
 * Discovery is lazy + cached; `invalidate` also flushes the core
 * project / config / package.json caches so a config edit is honored on
 * the next scan.
 */
export const createProjectGraph = (options: ProjectGraphOptions): ProjectGraph => {
  const roots = options.roots.map(normalizeDirectory);
  const logger = options.logger ?? SILENT_LOGGER;
  let projects: WorkspaceProject[] | null = null;

  const discover = (): WorkspaceProject[] => {
    const seen = new Map<string, WorkspaceProject>();
    for (const root of roots) {
      try {
        for (const workspacePackage of discoverReactSubprojects(root)) {
          const directory = normalizeDirectory(workspacePackage.directory);
          if (!seen.has(directory)) {
            seen.set(directory, { directory, name: workspacePackage.name });
          }
        }
      } catch (error) {
        logger.warn(`Project discovery failed for ${root}: ${messageFromUnknown(error)}`);
      }
    }
    // Deepest-first so owning-project resolution can take the first match.
    return [...seen.values()].sort(
      (first, second) => second.directory.length - first.directory.length,
    );
  };

  const ensure = (): WorkspaceProject[] => {
    if (projects === null) projects = discover();
    return projects;
  };

  return {
    listProjects: () => ensure(),
    resolveOwningProject: (absoluteFilePath) => {
      const normalizedFile = normalizeDirectory(absoluteFilePath);
      for (const project of ensure()) {
        if (isInsideDirectory(normalizedFile, project.directory)) return project.directory;
      }
      return null;
    },
    refresh: () => {
      projects = discover();
    },
    invalidate: () => {
      clearProjectCache();
      clearConfigCache();
      clearPackageJsonCache();
      clearIgnorePatternsCache();
      clearAutoSuppressionCaches();
      clearMinifiedFileCache();
      projects = null;
    },
  };
};
