import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ProjectInfo } from "../src/types/index.js";

const resolveGithubActionsScoreMetadataMock = vi.hoisted(() => vi.fn());

vi.mock("../src/utils/resolve-github-actions-score-metadata.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/utils/resolve-github-actions-score-metadata.js")
  >()),
  resolveGithubActionsScoreMetadata: resolveGithubActionsScoreMetadataMock,
}));

import { GitInvocationFailed, ReactDoctorError } from "../src/errors.js";
import { startScoreMetadataExecution } from "../src/score-metadata-execution.js";
import { Git } from "../src/services/git.js";

const ROOT_DIRECTORY = "/repo";

const project = {
  rootDirectory: ROOT_DIRECTORY,
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 17,
} satisfies ProjectInfo;

const gitFailure = (args: ReadonlyArray<string>): ReactDoctorError =>
  new ReactDoctorError({
    reason: new GitInvocationFailed({
      args,
      directory: ROOT_DIRECTORY,
      cause: new Error("git unavailable"),
    }),
  });

beforeEach(() => {
  resolveGithubActionsScoreMetadataMock.mockReset();
  resolveGithubActionsScoreMetadataMock.mockReturnValue({});
});

describe("startScoreMetadataExecution", () => {
  it("reads Git metadata in parallel, starts the gated viewer lookup, and joins it late", async () => {
    const events: string[] = [];

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repoStarted = yield* Deferred.make<void>();
        const shaStarted = yield* Deferred.make<void>();
        const defaultBranchStarted = yield* Deferred.make<void>();
        const releaseGitReads = yield* Deferred.make<void>();
        const viewerStarted = yield* Deferred.make<void>();
        const releaseViewer = yield* Deferred.make<void>();

        const gitLayer = Layer.mock(Git, {
          githubRepo: (directory) => {
            events.push(`repo:called:${directory}`);
            return Effect.gen(function* () {
              events.push("repo:started");
              yield* Deferred.succeed(repoStarted, undefined);
              yield* Deferred.await(releaseGitReads);
              events.push("repo:complete");
              return "millionco/sample-app";
            });
          },
          headSha: (directory) => {
            events.push(`sha:called:${directory}`);
            return Effect.gen(function* () {
              events.push("sha:started");
              yield* Deferred.succeed(shaStarted, undefined);
              yield* Deferred.await(releaseGitReads);
              events.push("sha:complete");
              return "abc123";
            });
          },
          defaultBranch: (directory) => {
            events.push(`branch:called:${directory}`);
            return Effect.gen(function* () {
              events.push("branch:started");
              yield* Deferred.succeed(defaultBranchStarted, undefined);
              yield* Deferred.await(releaseGitReads);
              events.push("branch:complete");
              return "main";
            });
          },
          githubViewerPermission: (input) => {
            events.push(`viewer:called:${input.directory}:${input.repo}`);
            return Effect.gen(function* () {
              events.push("viewer:started");
              yield* Deferred.succeed(viewerStarted, undefined);
              yield* Deferred.await(releaseViewer);
              events.push("viewer:complete");
              return "maintain";
            });
          },
        });

        let eventsBeforeGitRelease: string[] = [];
        const gitReadController = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.await(repoStarted);
            yield* Deferred.await(shaStarted);
            yield* Deferred.await(defaultBranchStarted);
            eventsBeforeGitRelease = [...events];
            yield* Deferred.succeed(releaseGitReads, undefined);
          }),
        );

        const execution = yield* Effect.gen(function* () {
          const gitService = yield* Git;
          return yield* startScoreMetadataExecution({
            gitService,
            directory: ROOT_DIRECTORY,
            project,
            isCi: false,
            shouldResolveLocalGithubViewerPermission: true,
            doctorVersion: "0.9.1",
            runId: "run-123",
          });
        }).pipe(Effect.provide(gitLayer));
        yield* Fiber.join(gitReadController);
        yield* Deferred.await(viewerStarted);
        events.push("lint:checkpoint");

        const joinFiber = yield* Effect.forkChild(
          execution.join.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                events.push("metadata:complete");
              }),
            ),
          ),
        );
        yield* Effect.yieldNow;
        const eventsBeforeViewerRelease = [...events];
        yield* Deferred.succeed(releaseViewer, undefined);
        const metadata = yield* Fiber.join(joinFiber);

        return {
          eventsBeforeGitRelease,
          eventsBeforeViewerRelease,
          metadata,
        };
      }),
    );

    expect(result.eventsBeforeGitRelease).toEqual(
      expect.arrayContaining(["repo:started", "sha:started", "branch:started"]),
    );
    expect(result.eventsBeforeGitRelease).not.toContain("repo:complete");
    expect(result.eventsBeforeGitRelease).not.toContain("sha:complete");
    expect(result.eventsBeforeGitRelease).not.toContain("branch:complete");
    expect(events.slice(0, 3)).toEqual([
      "repo:called:/repo",
      "sha:called:/repo",
      "branch:called:/repo",
    ]);
    expect(events.indexOf("viewer:started")).toBeLessThan(events.indexOf("lint:checkpoint"));
    expect(result.eventsBeforeViewerRelease).not.toContain("metadata:complete");
    expect(events.indexOf("viewer:complete")).toBeLessThan(events.indexOf("metadata:complete"));
    expect(result.metadata).toEqual({
      repo: "millionco/sample-app",
      sha: "abc123",
      framework: "vite",
      reactVersion: "19.0.0",
      sourceFileCount: 17,
      defaultBranch: "main",
      doctorVersion: "0.9.1",
      runId: "run-123",
      githubViewerPermission: "maintain",
    });
    expect(resolveGithubActionsScoreMetadataMock).not.toHaveBeenCalled();
  });

  it("fails Git reads open to null metadata and does not query a viewer without a repo", async () => {
    const githubViewerPermission = vi.fn(() => Effect.succeed("maintain"));
    const gitLayer = Layer.mock(Git, {
      githubRepo: () => Effect.fail(gitFailure(["config", "--get", "remote.origin.url"])),
      headSha: () => Effect.fail(gitFailure(["rev-parse", "HEAD"])),
      defaultBranch: () => Effect.fail(gitFailure(["symbolic-ref", "origin/HEAD"])),
      githubViewerPermission,
    });

    const metadata = await Effect.runPromise(
      Effect.gen(function* () {
        const gitService = yield* Git;
        const execution = yield* startScoreMetadataExecution({
          gitService,
          directory: ROOT_DIRECTORY,
          project,
          isCi: false,
          shouldResolveLocalGithubViewerPermission: true,
          doctorVersion: undefined,
          runId: undefined,
        });
        return yield* execution.join;
      }).pipe(Effect.provide(gitLayer)),
    );

    expect(metadata).toEqual({
      framework: "vite",
      reactVersion: "19.0.0",
      sourceFileCount: 17,
    });
    expect(githubViewerPermission).not.toHaveBeenCalled();
  });

  it("resolves GitHub Actions metadata after Git and never starts a local viewer lookup in CI", async () => {
    const events: string[] = [];
    resolveGithubActionsScoreMetadataMock.mockImplementation(() => {
      events.push("github-actions:resolve");
      return {
        githubEventName: "pull_request",
        githubActorAssociation: "MEMBER",
      };
    });
    const githubViewerPermission = vi.fn(() => Effect.succeed("maintain"));
    const gitLayer = Layer.mock(Git, {
      githubRepo: () =>
        Effect.sync(() => {
          events.push("repo:complete");
          return "millionco/sample-app";
        }),
      headSha: () =>
        Effect.sync(() => {
          events.push("sha:complete");
          return "abc123";
        }),
      defaultBranch: () =>
        Effect.sync(() => {
          events.push("branch:complete");
          return "main";
        }),
      githubViewerPermission,
    });

    const metadata = await Effect.runPromise(
      Effect.gen(function* () {
        const gitService = yield* Git;
        const execution = yield* startScoreMetadataExecution({
          gitService,
          directory: ROOT_DIRECTORY,
          project,
          isCi: true,
          shouldResolveLocalGithubViewerPermission: true,
          doctorVersion: undefined,
          runId: undefined,
        });
        return yield* execution.join;
      }).pipe(Effect.provide(gitLayer)),
    );

    expect(events.indexOf("repo:complete")).toBeLessThan(events.indexOf("github-actions:resolve"));
    expect(events.indexOf("sha:complete")).toBeLessThan(events.indexOf("github-actions:resolve"));
    expect(events.indexOf("branch:complete")).toBeLessThan(
      events.indexOf("github-actions:resolve"),
    );
    expect(githubViewerPermission).not.toHaveBeenCalled();
    expect(metadata).toEqual({
      repo: "millionco/sample-app",
      sha: "abc123",
      framework: "vite",
      reactVersion: "19.0.0",
      sourceFileCount: 17,
      defaultBranch: "main",
      githubEventName: "pull_request",
      githubActorAssociation: "MEMBER",
    });
  });

  it("fails an escaping viewer-permission error open at join", async () => {
    const gitLayer = Layer.mock(Git, {
      githubRepo: () => Effect.succeed("millionco/sample-app"),
      headSha: () => Effect.succeed("abc123"),
      defaultBranch: () => Effect.succeed("main"),
      githubViewerPermission: () => Effect.fail(gitFailure(["api", "graphql"])),
    });

    const metadata = await Effect.runPromise(
      Effect.gen(function* () {
        const gitService = yield* Git;
        const execution = yield* startScoreMetadataExecution({
          gitService,
          directory: ROOT_DIRECTORY,
          project,
          isCi: false,
          shouldResolveLocalGithubViewerPermission: true,
          doctorVersion: undefined,
          runId: undefined,
        });
        return yield* execution.join;
      }).pipe(Effect.provide(gitLayer)),
    );

    expect(metadata).toEqual({
      repo: "millionco/sample-app",
      sha: "abc123",
      framework: "vite",
      reactVersion: "19.0.0",
      sourceFileCount: 17,
      defaultBranch: "main",
    });
  });

  it("interrupts an unfinished viewer child when its parent exits", async () => {
    let resolveViewerStarted = (): void => undefined;
    let resolveViewerInterrupted = (): void => undefined;
    const viewerStarted = new Promise<void>((resolve) => {
      resolveViewerStarted = resolve;
    });
    const viewerInterrupted = new Promise<void>((resolve) => {
      resolveViewerInterrupted = resolve;
    });
    const gitLayer = Layer.mock(Git, {
      githubRepo: () => Effect.succeed("millionco/sample-app"),
      headSha: () => Effect.succeed("abc123"),
      defaultBranch: () => Effect.succeed("main"),
      githubViewerPermission: () =>
        Effect.gen(function* () {
          resolveViewerStarted();
          return yield* Effect.never;
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              resolveViewerInterrupted();
            }),
          ),
        ),
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const gitService = yield* Git;
        yield* startScoreMetadataExecution({
          gitService,
          directory: ROOT_DIRECTORY,
          project,
          isCi: false,
          shouldResolveLocalGithubViewerPermission: true,
          doctorVersion: undefined,
          runId: undefined,
        });
        yield* Effect.promise(() => viewerStarted);
        return yield* Effect.die(new Error("synthetic post-fork defect"));
      }).pipe(Effect.provide(gitLayer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    await viewerInterrupted;
  });
});
