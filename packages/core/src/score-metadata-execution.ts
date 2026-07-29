import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { ScoreRequestMetadata } from "./calculate-score.js";
import type { Git } from "./services/git.js";
import type { ProjectInfo } from "./types/index.js";
import { buildScoreRequestMetadata } from "./utils/build-score-request-metadata.js";
import { resolveGithubActionsScoreMetadata } from "./utils/resolve-github-actions-score-metadata.js";

interface StartScoreMetadataExecutionInput {
  readonly gitService: Git["Service"];
  readonly directory: string;
  readonly project: ProjectInfo;
  readonly isCi: boolean;
  readonly shouldResolveLocalGithubViewerPermission: boolean;
  readonly doctorVersion: string | undefined;
  readonly runId: string | undefined;
}

interface ScoreMetadataExecution {
  readonly join: Effect.Effect<ScoreRequestMetadata>;
}

export const startScoreMetadataExecution = (
  input: StartScoreMetadataExecutionInput,
): Effect.Effect<ScoreMetadataExecution> =>
  Effect.gen(function* () {
    const [repo, sha, defaultBranch] = yield* Effect.all(
      [
        input.gitService
          .githubRepo(input.directory)
          .pipe(Effect.orElseSucceed((): string | null => null)),
        input.gitService
          .headSha(input.directory)
          .pipe(Effect.orElseSucceed((): string | null => null)),
        input.gitService
          .defaultBranch(input.directory)
          .pipe(Effect.orElseSucceed((): string | null => null)),
      ],
      { concurrency: 3 },
    );
    const githubActionsScoreMetadata = input.isCi ? resolveGithubActionsScoreMetadata() : {};
    const githubViewerPermissionFiber = yield* Effect.forkChild(
      input.shouldResolveLocalGithubViewerPermission && !input.isCi && repo !== null
        ? input.gitService
            .githubViewerPermission({
              directory: input.directory,
              repo,
            })
            .pipe(Effect.orElseSucceed((): string | null => null))
        : Effect.succeed<string | null>(null),
    );

    return {
      join: Effect.gen(function* () {
        const githubViewerPermission = yield* Fiber.join(githubViewerPermissionFiber);
        return buildScoreRequestMetadata({
          project: input.project,
          repo,
          sha,
          defaultBranch,
          doctorVersion: input.doctorVersion,
          runId: input.runId,
          githubActionsScoreMetadata,
          githubViewerPermission,
        });
      }),
    };
  });
