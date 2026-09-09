import {
  createGitRepositoryMetadataCache,
  type GitRepositoryMetadataCacheHandle,
} from "./create-git-repository-metadata-cache.js";

/**
 * Filesystem probes whose answer is a function of the worktree alone. Every
 * project of a workspace scan asks the same questions of the same directories,
 * so one CLI invocation answers each once instead of once per project.
 */
export interface WorkspaceProbeCache {
  readonly workspaceDirectoriesByRoot: Map<string, ReadonlyArray<string>>;
  readonly concreteVersionsByProbe: Map<string, string | null>;
}

/**
 * Memos shared across every project scan of one CLI invocation. `null` on the
 * `InvocationCaches` reference (the default) keeps each scan self-contained,
 * which is what a long-lived programmatic caller needs when the worktree can
 * change between `diagnose()` calls.
 */
export interface InvocationCachesHandle {
  readonly gitRepositoryMetadata: GitRepositoryMetadataCacheHandle;
  readonly workspaceProbes: WorkspaceProbeCache;
}

export const createInvocationCaches = (): InvocationCachesHandle => ({
  gitRepositoryMetadata: createGitRepositoryMetadataCache(),
  workspaceProbes: {
    workspaceDirectoriesByRoot: new Map(),
    concreteVersionsByProbe: new Map(),
  },
});
