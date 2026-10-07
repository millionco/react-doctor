import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { describe, expect, it } from "vite-plus/test";
import {
  createGitRepositoryMetadataCache,
  type GitRepositoryMetadata,
} from "../src/utils/create-git-repository-metadata-cache.js";

const metadataFor = (sha: string): GitRepositoryMetadata => ({
  repo: "owner/name",
  sha,
  defaultBranch: "main",
  githubViewerPermission: null,
});

describe("createGitRepositoryMetadataCache", () => {
  it("resolves once per repository root and shares the result", async () => {
    const cache = createGitRepositoryMetadataCache();
    let resolveCount = 0;
    const resolve = Effect.sync(() => {
      resolveCount += 1;
      return metadataFor(`sha-${resolveCount}`);
    });
    const [first, second, other] = await Effect.runPromise(
      Effect.all([
        cache.getOrResolve("/repo", resolve),
        cache.getOrResolve("/repo", resolve),
        cache.getOrResolve("/other", resolve),
      ]),
    );
    expect(first).toEqual(metadataFor("sha-1"));
    expect(second).toEqual(metadataFor("sha-1"));
    expect(other).toEqual(metadataFor("sha-2"));
    expect(resolveCount).toBe(2);
  });

  it("dedupes concurrent lookups of the same root", async () => {
    const cache = createGitRepositoryMetadataCache();
    let resolveCount = 0;
    const gate = Deferred.makeUnsafe<void>();
    const resolve = Effect.gen(function* () {
      resolveCount += 1;
      yield* Deferred.await(gate);
      return metadataFor("sha");
    });
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const firstCaller = yield* Effect.forkChild(cache.getOrResolve("/repo", resolve));
        const secondCaller = yield* Effect.forkChild(cache.getOrResolve("/repo", resolve));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        return yield* Effect.all([Fiber.join(firstCaller), Fiber.join(secondCaller)]);
      }),
    );
    expect(results).toEqual([metadataFor("sha"), metadataFor("sha")]);
    expect(resolveCount).toBe(1);
  });

  it("keeps resolving for later callers when the first caller is interrupted", async () => {
    const cache = createGitRepositoryMetadataCache();
    let resolveCount = 0;
    const gate = Deferred.makeUnsafe<void>();
    const resolve = Effect.gen(function* () {
      resolveCount += 1;
      yield* Deferred.await(gate);
      return metadataFor("sha");
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const firstCaller = yield* Effect.forkChild(cache.getOrResolve("/repo", resolve));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(firstCaller);
        const secondCaller = yield* Effect.forkChild(cache.getOrResolve("/repo", resolve));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        return yield* Fiber.join(secondCaller);
      }),
    );
    expect(result).toEqual(metadataFor("sha"));
    expect(resolveCount).toBe(1);
  });
});
