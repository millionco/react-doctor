import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

export interface GitRepositoryMetadata {
  readonly repo: string | null;
  readonly sha: string | null;
  readonly defaultBranch: string | null;
  readonly githubViewerPermission: string | null;
}

/**
 * Invocation-scoped memo of the repository-level git facts (`remote.origin.url`,
 * `HEAD`, default branch, viewer permission) keyed by repository root. Every
 * project of a monorepo shares one worktree, so one scan invocation resolves
 * them once instead of once per project.
 */
export interface GitRepositoryMetadataCacheHandle {
  readonly getOrResolve: (
    repositoryRoot: string,
    resolve: Effect.Effect<GitRepositoryMetadata>,
  ) => Effect.Effect<GitRepositoryMetadata>;
}

export const createGitRepositoryMetadataCache = (): GitRepositoryMetadataCacheHandle => {
  const metadataByRepositoryRoot = new Map<string, Deferred.Deferred<GitRepositoryMetadata>>();
  return {
    getOrResolve: (repositoryRoot, resolve) =>
      Effect.suspend(() => {
        const pending = metadataByRepositoryRoot.get(repositoryRoot);
        if (pending !== undefined) return Deferred.await(pending);
        const deferred = Deferred.makeUnsafe<GitRepositoryMetadata>();
        metadataByRepositoryRoot.set(repositoryRoot, deferred);
        // Resolved on a detached fiber so an aborted first project cannot
        // interrupt the lookup every later project of the repository awaits.
        return Effect.forkDetach(Deferred.into(resolve, deferred)).pipe(
          Effect.andThen(Deferred.await(deferred)),
        );
      }),
  };
};
